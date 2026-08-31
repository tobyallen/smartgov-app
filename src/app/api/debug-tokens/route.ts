import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

/**
 * Debug-only: exposes the caller's own raw ID/access tokens so the
 * DebugTokens footer can render them and link out to jwt.io. Session-gated
 * (never returns another user's tokens) but deliberately not otherwise
 * restricted — this is a demo app, and seeing the actual persona claim
 * (or its absence) in the ID token is the fastest way to debug the RBAC
 * gate that reads it in src/lib/roles.ts.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    idToken: session.tokenSet.idToken ?? null,
    accessToken: session.tokenSet.accessToken,
    user: session.user,
  });
}
