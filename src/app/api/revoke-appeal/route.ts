import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { checkOwner, logAppealRevoked } from '@/lib/fga';
import { caseIdFor, findCaseByCitizen } from '@/lib/provisioning';
import { firestore } from '@/lib/firebase-admin';

// A citizen action taken directly, not through the agent — mirrors
// /api/delegation's shape (session-gated, direct Firestore write, no OBO
// exchange) rather than submit_appeal's (agent-gated, case-service hop).
// See checkOwner in lib/fga.ts for why this checks `owner`, not
// agent_can_submit_appeal: revoking your own appeal doesn't need
// delegation to be on or the appeal window to still be open.
export async function POST() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const citizenUserId = session.user.sub;

  const row = await findCaseByCitizen(citizenUserId);
  if (!row) return NextResponse.json({ error: 'No case found' }, { status: 404 });

  if (row.status !== 'appeal_submitted') {
    return NextResponse.json({ error: 'No submitted appeal to revoke.' }, { status: 409 });
  }

  const allowed = await checkOwner({ onBehalfOf: citizenUserId, caseId: caseIdFor(row.id) });
  if (!allowed) {
    return NextResponse.json({ error: 'Not authorized to revoke this appeal.' }, { status: 403 });
  }

  await firestore().collection('cases').doc(row.id).update({ status: 'open' });
  await logAppealRevoked({ onBehalfOf: citizenUserId, caseId: caseIdFor(row.id) });

  return NextResponse.json({ revoked: true });
}
