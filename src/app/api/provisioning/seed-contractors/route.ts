import { NextRequest, NextResponse } from 'next/server';
import { ensureCaseworkerProvisioned } from '@/lib/provisioning';

/**
 * Called synchronously from the post-login Action's caseworker
 * first-login path (auth0-actions/assign-persona-role.js), same shared
 * secret and same "no session cookie yet" reasoning as
 * /api/provisioning/sync. Without this, caseworker_managed and
 * caseworker_can_bulk_disable tuples never exist for a fresh caseworker
 * signup - every contractor tool denies unconditionally until someone
 * manually runs scripts/seed-contractors.ts, which contradicts "a sent
 * link should just work."
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

  await ensureCaseworkerProvisioned(userId);

  return NextResponse.json({ provisioned: true });
}
