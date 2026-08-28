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

  const { tuples } = await fga.read({
    user: `user:${caseworkerUserId}`,
    relation: 'caseworker_managed',
  });
  const alreadyGranted = new Set(tuples.map((t) => t.key.object));

  const writes = CONTRACTORS.filter((c) => !alreadyGranted.has(`contractor:${c.id}`)).map(
    (c) => ({ user: `user:${caseworkerUserId}`, relation: 'caseworker_managed', object: `contractor:${c.id}` }),
  );

  if (writes.length > 0) {
    await fga.write({ writes });
    console.log(`FGA: granted caseworker_managed on ${writes.length} contractor(s) to user:${caseworkerUserId}`);
  } else {
    console.log('FGA: all tuples already granted, nothing to write.');
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
