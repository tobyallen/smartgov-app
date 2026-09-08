import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

// Same decode approach as personaFor in src/lib/roles.ts (Buffer, not
// atob — this runs server-side, and TokenBlock.tsx's browser version of
// this helper is a 'use client' module not meant to be imported here).
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

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

  // Decoded from the raw ID token, not session.user — session.user gets
  // silently overwritten with a narrower claim set on a silent token
  // refresh (see src/lib/roles.ts's personaFor for the confirmed SDK
  // behaviour this works around), and email is exactly the kind of
  // field that bug could otherwise make intermittently disappear here.
  const idClaims = session.tokenSet.idToken ? decodeJwtPayload(session.tokenSet.idToken) : null;
  const email = typeof idClaims?.email === 'string' ? idClaims.email : null;

  return NextResponse.json({
    idToken: session.tokenSet.idToken ?? null,
    accessToken: session.tokenSet.accessToken,
    user: session.user,
    email,
  });
}
