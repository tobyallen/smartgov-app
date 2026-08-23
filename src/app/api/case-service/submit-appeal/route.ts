import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { cases } from '@/lib/db/schema';
import { checkAndLog } from '@/lib/fga';
import { caseIdFor, agentIdFor } from '@/lib/provisioning';

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
  const row = await db.query.cases.findFirst({ where: eq(cases.id, caseRowId) });
  if (!row || row.citizenUserId !== citizenUserId) {
    return NextResponse.json({ error: 'Case not found' }, { status: 404 });
  }

  // Independent FGA check — defense in depth, not a re-run of the
  // upstream decision. If this diverges from the upstream check, that's
  // a real inconsistency to surface, not paper over.
  const allowed = await checkAndLog({
    citizenUserId,
    subject: agentIdFor(citizenUserId),
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

  await db.update(cases).set({ status: 'appeal_submitted' }).where(eq(cases.id, row.id));

  return NextResponse.json({ submitted: true });
}
