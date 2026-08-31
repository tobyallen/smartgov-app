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
