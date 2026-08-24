import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { firebaseAuth } from '@/lib/firebase-admin';

/**
 * The Auth0 <-> Firestore identity bridge. Auth0 is the app's real
 * identity system; Firestore security rules only know about Firebase
 * Auth's own `request.auth`, a completely separate system that has no
 * idea an Auth0 session exists. Without this, Firestore rules scoped to
 * `request.auth.uid` are either unenforceable (browser can never satisfy
 * them) or the app has to fall back to public rules (insecure).
 *
 * Fix: mint a Firebase custom token whose uid equals the Auth0 `sub`, so
 * the client can call signInWithCustomToken and get a real Firebase Auth
 * session where request.auth.uid == the Auth0 sub. This has to run
 * before any client-side Firestore listener is wired up.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const customToken = await firebaseAuth().createCustomToken(session.user.sub);
  return NextResponse.json({ customToken });
}
