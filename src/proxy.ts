import { NextResponse, type NextRequest } from 'next/server';
import { auth0 } from '@/lib/auth0';

// Every page below already checks auth0.getSession() itself and renders
// an inline "log in" link when it's missing (case/page.tsx et al) - that
// still works, but on a session that's expired rather than merely
// absent (e.g. a tab left open overnight, past the 1-hour inactivity
// window configured in lib/auth0.ts) it's a much better experience to
// bounce straight to login than to land on a page that then quietly
// fails the first API call it makes.
const PROTECTED_PATHS = ['/case', '/chat', '/admin', '/access-log', '/recap'];

export async function proxy(request: NextRequest) {
  const authResponse = await auth0.middleware(request);

  const { pathname } = request.nextUrl;
  if (!PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return authResponse;
  }

  // auth0.middleware() already rolled/refreshed the session above if one
  // existed and was still within its inactivity/absolute window - a
  // session that's genuinely dead (never existed, or aged past both
  // windows) won't be resurrected by that call, so checking afterwards
  // reflects the real, current state rather than a stale read.
  const session = await auth0.getSession(request);
  if (!session) {
    const returnTo = encodeURIComponent(pathname);
    return NextResponse.redirect(new URL(`/auth/login?returnTo=${returnTo}`, request.url));
  }

  return authResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
