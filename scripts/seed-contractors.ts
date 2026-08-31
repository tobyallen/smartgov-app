// One-off seed for the MCP vignette: writes 5 mock contractors to
// Firestore and grants their caseworker_managed FGA tuple to a single
// designated caseworker. Idempotent — deterministic contractor IDs, and
// FGA writes on an already-existing tuple are just no-ops on replay via
// write-if-not-exists semantics (openfga errors on true duplicates, so
// this checks first rather than relying on that).
//
// Run once: npx tsx scripts/seed-contractors.ts <caseworkerUserId>
// Example:  npx tsx scripts/seed-contractors.ts 'auth0|6a90d282845dfccdcb855f63'

import { firestore } from '../src/lib/firebase-admin';
import { getFgaClient } from '../src/lib/fga';

const CONTRACTORS = [
  { id: 'contractor-1', name: 'Riverside Grounds Maintenance' },
  { id: 'contractor-2', name: 'Northside Waste Collection' },
  { id: 'contractor-3', name: 'Civic Hall Security Services' },
  { id: 'contractor-4', name: 'Metro Road Resurfacing Co' },
  { id: 'contractor-5', name: 'Parks & Playgrounds Ltd' },
];

async function main() {
  const caseworkerUserId = process.argv[2];
  if (!caseworkerUserId) {
    console.error('Usage: npx tsx scripts/seed-contractors.ts <caseworkerUserId>');
    process.exit(1);
  }

  const db = firestore();
  const fga = getFgaClient();

  for (const contractor of CONTRACTORS) {
    await db.collection('contractors').doc(contractor.id).set({
      name: contractor.name,
      status: 'active',
    });
    console.log(`Firestore: contractor:${contractor.id} — ${contractor.name}`);
  }

  // object needs a type even without a specific id — the read API rejects
  // a tuple_key that only has user+relation (no object type at all).
  async function grantedObjectsFor(relation: string) {
    const { tuples } = await fga.read({ user: `user:${caseworkerUserId}`, relation, object: 'contractor:' });
    return new Set(tuples.map((t) => t.key.object));
  }

  const alreadyManaged = await grantedObjectsFor('caseworker_managed');
  const managedWrites = CONTRACTORS.filter((c) => !alreadyManaged.has(`contractor:${c.id}`)).map((c) => ({
    user: `user:${caseworkerUserId}`,
    relation: 'caseworker_managed',
    object: `contractor:${c.id}`,
  }));

  if (managedWrites.length > 0) {
    await fga.write({ writes: managedWrites });
    console.log(`FGA: granted caseworker_managed on ${managedWrites.length} contractor(s) to user:${caseworkerUserId}`);
  } else {
    console.log('FGA: caseworker_managed already granted on all contractors, nothing to write.');
  }

  // caseworker_can_bulk_disable is a SEPARATE relation from
  // caseworker_managed, gated by the step_up_approved condition at check
  // time — the tuple itself just needs to exist and reference the
  // condition by name; the actual approved_at/current_time values are
  // supplied fresh on every check (checkStepUpBulkDisable in fga.ts),
  // never stored on the tuple. Without this tuple, bulk_disable_contractors
  // denies unconditionally regardless of step-up state, because there's
  // no relationship to evaluate the condition against at all.
  const alreadyBulkGranted = await grantedObjectsFor('caseworker_can_bulk_disable');
  const bulkWrites = CONTRACTORS.filter((c) => !alreadyBulkGranted.has(`contractor:${c.id}`)).map((c) => ({
    user: `user:${caseworkerUserId}`,
    relation: 'caseworker_can_bulk_disable',
    object: `contractor:${c.id}`,
    condition: { name: 'step_up_approved', context: {} },
  }));

  if (bulkWrites.length > 0) {
    await fga.write({ writes: bulkWrites });
    console.log(`FGA: granted caseworker_can_bulk_disable on ${bulkWrites.length} contractor(s) to user:${caseworkerUserId}`);
  } else {
    console.log('FGA: caseworker_can_bulk_disable already granted on all contractors, nothing to write.');
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
