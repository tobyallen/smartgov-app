import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { isCaseworker } from '@/lib/roles';
import { firestore } from '@/lib/firebase-admin';

/**
 * Server-asserted step-up: the caseworker hits this to simulate a second
 * factor having just happened (a real system would use CIBA or a fresh
 * MFA challenge here — this route is a deliberate demo shortcut, not a
 * pattern to copy). It writes the approval; bulk_disable_contractors
 * later reads it server-side and evaluates the step_up_approved condition
 * against it. The caller never gets to assert approval directly.
 */
export async function POST() {
  const session = await auth0.getSession();
  if (!session || !isCaseworker(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await firestore()
    .collection('stepUpApprovals')
    .doc(session.user.sub)
    .set({ approvedAt: new Date() });

  return NextResponse.json({ approved: true });
}

/**
 * Step-down: unlike delegation's revoke (which deletes an FGA tuple),
 * caseworker_can_bulk_disable is a standing grant gated purely by the
 * step_up_approved condition (see fga-model.fga) — there's no tuple to
 * remove, only the approvedAt timestamp the condition reads fresh on
 * every check. Setting it to the epoch makes the condition fail on the
 * next check, same effect as a real revoke, without needing a separate
 * debug-only escape hatch the way delegation's expireDelegationNow does.
 */
export async function DELETE() {
  const session = await auth0.getSession();
  if (!session || !isCaseworker(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await firestore()
    .collection('stepUpApprovals')
    .doc(session.user.sub)
    .set({ approvedAt: new Date(0) });

  return NextResponse.json({ approved: false });
}
