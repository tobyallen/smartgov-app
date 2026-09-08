import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { firestore } from '@/lib/firebase-admin';
import { checkAndLog } from '@/lib/fga';
import { caseIdFor, agentIdFor, findCaseById } from '@/lib/provisioning';

// The downstream "case service" — deliberately a separate API identity
// (Custom API / resource server in Auth0) from the main app, so the OBO
// exchange has something real to prove: this endpoint only accepts the
// exchanged token, and independently re-checks FGA rather than trusting
// the upstream chatbot's decision.
const JWKS = createRemoteJWKSet(new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`));

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
  }

  const token = authHeader.slice('Bearer '.length);
  let claims;
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      audience: process.env.CASE_SERVICE_AUDIENCE,
    });
    claims = payload;
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  // `sub` is the citizen (identity preserved through the exchange); `act`
  // identifies the agent that performed the exchange on their behalf.
  const citizenUserId = claims.sub as string;
  const actingAs = claims.act as { sub?: string } | undefined;
  if (!actingAs) {
    return NextResponse.json({ error: 'Token is not a delegated (act) token' }, { status: 403 });
  }

  const { caseId: caseRowId } = await request.json();
  const row = await findCaseById(caseRowId);
  if (!row || row.citizenUserId !== citizenUserId) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  // A repeat submit_appeal call (e.g. the golden-path button clicked
  // twice, or the model re-calling the tool per its own system-prompt
  // instruction to never trust a stale result) would otherwise silently
  // re-run the FGA check and Firestore write and return the same
  // { submitted: true } as the first call - confirmed live, with no way
  // for the citizen or the model to tell "just submitted" apart from
  // "already submitted a while ago." Checked before the FGA call so a
  // duplicate doesn't cost a real check/write for no reason.
  if (row.status === 'appeal_submitted') {
    return NextResponse.json({ submitted: true, alreadySubmitted: true });
  }

  // Independent FGA check — defense in depth, not a re-run of the
  // upstream decision. If this diverges from the upstream check, that's
  // a real inconsistency to surface, not paper over.
  const allowed = await checkAndLog({
    onBehalfOf: citizenUserId,
    actingPrincipal: agentIdFor(citizenUserId),
    relation: 'agent_can_submit_appeal',
    object: caseIdFor(row.id),
    context: {
      current_time: new Date().toISOString(),
      assessment_time: row.assessmentTime.toISOString(),
    },
  });

  if (!allowed) {
    return NextResponse.json({ error: 'Denied by Case Service FGA check' }, { status: 403 });
  }

  await firestore().collection('cases').doc(row.id).update({ status: 'appeal_submitted' });

  return NextResponse.json({ submitted: true });
}
