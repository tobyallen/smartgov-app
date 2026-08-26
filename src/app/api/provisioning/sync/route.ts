import { NextRequest, NextResponse } from 'next/server';
import { ensureCitizenProvisioned } from '@/lib/provisioning';

/**
 * Called synchronously from the post-login Action's first-login path
 * (auth0-actions/provision-citizen-record.js), not from the browser -
 * there's no Auth0 session cookie yet at that point in the login
 * transaction, since the token hasn't been issued back to the browser.
 * Authenticated by a shared secret header instead of a session.
 *
 * Runs the same ensureCitizenProvisioned() the app already calls lazily
 * from /case and /chat - this route doesn't change what gets written,
 * only when: on first login, before the redirect completes, rather than
 * whenever the citizen happens to first load a page that needs it.
 */
export async function POST(request: NextRequest) {
  const providedSecret = request.headers.get('x-provisioning-secret');
  if (!providedSecret || providedSecret !== process.env.PROVISIONING_SYNC_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId } = await request.json();
  if (typeof userId !== 'string' || !userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  await ensureCitizenProvisioned(userId);

  return NextResponse.json({ provisioned: true });
}
