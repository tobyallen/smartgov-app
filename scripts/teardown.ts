/**
 * npm run teardown — reverses what setup.ts created and is safely
 * reversible: FGA tuples this app's own object types own (not the store
 * itself - FGA_STORE_ID is a real credential someone would have to
 * re-collect, and deleting the store is a different, more destructive
 * operation than clearing its data), seeded contractor records, and the
 * two post-login Actions.
 *
 * Deliberately does NOT delete: the Auth0 tenant, the FGA store, the
 * Firebase project, the Vercel project, or any Application/API/Role
 * registered in the tenant - those are account-level or hold IDs other
 * env vars still reference, and re-creating them isn't as cheap as the
 * things this script does remove. This is for rehearsal rebuilds
 * (clear the data, keep the scaffolding, run `npm run setup` again),
 * not full teardown of everyone's real accounts.
 *
 * Scoped, not a full-store wipe (fixed after adversarial review,
 * 2026-09-22): only deletes tuples whose OBJECT type is one this app's
 * own model defines (case/agent-as-object never happens, contractor) -
 * a bare "delete everything the store returns" would also erase real
 * signed-up citizens' owner/agent_delegate/agent_can_submit_appeal
 * tuples on their own case: objects, which this script has no business
 * touching just because it's clearing demo scaffolding. If this store
 * is ever reused for anything beyond this app, review this list.
 *
 * Destructive against real tenant/store data - requires --yes to run
 * non-interactively, otherwise prompts for confirmation.
 *
 * Run: npx tsx scripts/teardown.ts [--yes]
 */
import { createInterface } from 'node:readline/promises';
import { execFileSync } from 'node:child_process';
import { auth0, auth0Json, requireAuth0Cli } from './lib/auth0Cli';
import { firestore } from '../src/lib/firebase-admin';
import { CONTRACTORS } from '../src/lib/provisioning';

const REQUIRED_ENV_VARS = [
  'FGA_API_URL',
  'FGA_STORE_ID',
  'FGA_CLIENT_ID',
  'FGA_CLIENT_SECRET',
  'FGA_API_TOKEN_ISSUER',
  'FGA_API_AUDIENCE',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
];

// Object types this script is willing to delete FGA tuples for -
// deliberately excludes `case:`/`agent:` (real per-citizen data this
// script has no business touching) even though setup.ts writes no
// tuples against those types itself; only contractor grants are
// genuinely setup/seed-script-owned.
const TEARDOWN_OWNED_OBJECT_TYPES = ['contractor:'];

function step(n: number, label: string) {
  console.log(`\n[${n}/5] ${label}`);
}

function checkEnv(): void {
  step(1, 'Checking required environment variables');
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  console.log(`  All ${REQUIRED_ENV_VARS.length} required env vars are set.`);
}

function requireFgaCli(): void {
  try {
    execFileSync('fga', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error('The `fga` CLI is required (https://github.com/openfga/cli). Install it, then re-run this script.');
  }
}

async function confirm(): Promise<void> {
  if (process.argv.includes('--yes')) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `This deletes FGA tuples in FGA_STORE_ID whose object type is one of [${TEARDOWN_OWNED_OBJECT_TYPES.join(', ')}], ` +
      'all seeded contractor records, and the two SmartGov post-login Actions. It does NOT delete the tenant, the FGA ' +
      'store itself, any Application/API/Role, or any case:/agent: tuples belonging to real signed-up citizens. ' +
      'Type "yes" to continue: ',
  );
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Aborted.');
    process.exit(1);
  }
}

function clearFgaTuples(): void {
  step(2, `Clearing FGA tuples for object types [${TEARDOWN_OWNED_OBJECT_TYPES.join(', ')}] (store itself is kept)`);
  requireFgaCli();
  const commonFlags = [
    '--store-id',
    process.env.FGA_STORE_ID!,
    '--api-url',
    process.env.FGA_API_URL!,
    '--api-token-issuer',
    process.env.FGA_API_TOKEN_ISSUER!,
    '--api-audience',
    process.env.FGA_API_AUDIENCE!,
    '--client-id',
    process.env.FGA_CLIENT_ID!,
    '--client-secret',
    process.env.FGA_CLIENT_SECRET!,
  ];

  type TupleReadResult = { tuples?: Array<{ key?: { user?: string; relation?: string; object?: string } }> };
  let parsed: TupleReadResult;
  const readOutput = execFileSync(
    'fga',
    ['tuple', 'read', ...commonFlags, '--max-pages', '0', '--output-format', 'json'],
    { encoding: 'utf8' },
  );
  try {
    parsed = JSON.parse(readOutput) as TupleReadResult;
  } catch {
    throw new Error(`\`fga tuple read\` did not return valid JSON. Raw output:\n${readOutput}`);
  }
  if (!Array.isArray(parsed.tuples)) {
    throw new Error(`\`fga tuple read\` returned an unexpected shape (no "tuples" array). Raw output:\n${readOutput}`);
  }

  const allTuples = parsed.tuples;
  const toDelete = allTuples.filter(
    (t) => t.key?.object && TEARDOWN_OWNED_OBJECT_TYPES.some((prefix) => t.key!.object!.startsWith(prefix)),
  );
  const skipped = allTuples.length - toDelete.length;

  if (toDelete.length === 0) {
    console.log(`  No matching tuples to delete (${skipped} tuple(s) in the store belong to other object types, left untouched).`);
    return;
  }

  console.log(`  Deleting ${toDelete.length} tuple(s); leaving ${skipped} tuple(s) of other object types untouched.`);
  for (const { key } of toDelete) {
    execFileSync(
      'fga',
      ['tuple', 'delete', ...commonFlags, key!.user!, key!.relation!, key!.object!, '--on-missing', 'ignore'],
      { stdio: 'inherit' },
    );
  }
}

async function clearContractors(): Promise<void> {
  step(3, 'Clearing seeded contractor records');
  const db = firestore();
  for (const contractor of CONTRACTORS) {
    await db.collection('contractors').doc(contractor.id).delete();
  }
  console.log(`  Deleted ${CONTRACTORS.length} contractor record(s).`);
}

function deleteActions(): void {
  step(4, 'Deleting the two SmartGov post-login Actions');
  requireAuth0Cli();
  type Auth0Action = { id: string; name: string };
  const actions = auth0Json<Auth0Action[]>(['actions', 'list']);
  const names = ['Assign Persona Role', 'Provision Citizen Record'];
  for (const name of names) {
    const found = actions.find((a) => a.name === name);
    if (!found) {
      console.log(`  Action "${name}" not found, nothing to delete.`);
      continue;
    }
    try {
      console.log(`  Deleting Action "${name}" (${found.id}).`);
      auth0(['actions', 'delete', found.id, '--force']);
    } catch (err) {
      // A bound Action can't always be deleted cleanly - fixing this by
      // continuing regardless would risk leaving a broken Action
      // reference in the Login flow. Surface it and stop rather than
      // silently skip, so the operator unbinds it in the dashboard
      // (Actions -> Flows -> Login) before re-running.
      throw new Error(
        `Failed to delete Action "${name}" (${found.id}) - it may still be bound to the Login flow. ` +
          `Unbind it via the Auth0 dashboard (Actions -> Flows -> Login) first, then re-run teardown. Original error: ${
            err instanceof Error ? err.message : err
          }`,
      );
    }
  }
}

function reminders(): void {
  step(5, 'Not deleted by this script');
  console.log(
    [
      '  - The Auth0 tenant, Applications, APIs (resource servers), and Roles',
      '  - The FGA store itself (FGA_STORE_ID) and its model versions',
      '  - Any case:/agent: FGA tuples belonging to real signed-up citizens',
      '  - The Firebase project, and any cases/agents/auditEvents/mcpTokenCache docs',
      '  - The Vercel project/deployment',
      '  Run `npm run setup` again to rebuild what this script cleared.',
    ].join('\n'),
  );
}

async function main() {
  checkEnv();
  await confirm();
  clearFgaTuples();
  await clearContractors();
  deleteActions();
  reminders();
  console.log('\nTeardown complete.');
}

main().catch((err) => {
  console.error('\nTeardown failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
