// Manual one-off entry point for ensureCaseworkerProvisioned() - useful
// for backfilling a caseworker account created before the automatic
// seeding was wired into auth0-actions/assign-persona-role.js and
// src/app/admin/page.tsx. Not required for normal operation any more;
// both of those call sites are idempotent and self-healing on their own.
//
// Run: npx tsx scripts/seed-contractors.ts <caseworkerUserId>
// Example: npx tsx scripts/seed-contractors.ts 'auth0|6a90d282845dfccdcb855f63'

import { ensureCaseworkerProvisioned } from '../src/lib/provisioning';

async function main() {
  const caseworkerUserId = process.argv[2];
  if (!caseworkerUserId) {
    console.error('Usage: npx tsx scripts/seed-contractors.ts <caseworkerUserId>');
    process.exit(1);
  }

  await ensureCaseworkerProvisioned(caseworkerUserId);
  console.log(`Seeded contractors and FGA grants for user:${caseworkerUserId}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
