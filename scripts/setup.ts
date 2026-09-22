/**
 * npm run setup — takes an already-created Auth0 tenant + Firebase
 * project + Vercel/AI Gateway account (real lead-time prerequisites,
 * out of scope for this script - see README "Deploying your own copy")
 * to a working deployment. Safe to re-run against a partially-set-up
 * tenant, e.g. after fixing a missing env var - roles/APIs/Actions are
 * check-then-create, and contractor seeding is a plain merge. The one
 * exception is the FGA model push, which writes a new model version on
 * every run rather than a true no-op (see pushFgaModel below) - re-runs
 * are still safe, just not literally idempotent for that one step.
 *
 * What this DOESN'T do, deliberately:
 * - Create the Auth0 tenant, Firebase project, or Vercel project
 *   themselves (account-level, real lead time, not scriptable).
 * - Register the two Agent-as-Principal identities (`agent_id` via
 *   PATCH /clients/{id}, `agent_subject_claims` on resource servers) -
 *   this required an EA feature toggle on the tenant per
 *   smartgov_build_state.md/the AI Identity series, so it's a manual
 *   step, not scripted here.
 * - Deploy the app itself (`vercel` / git push, per the standing rule:
 *   never `vercel deploy`/`--prod` directly from the CLI).
 *
 * Run: npx tsx scripts/setup.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { auth0, auth0Json, requireAuth0Cli } from './lib/auth0Cli';
import { getFgaClient } from '../src/lib/fga';
import { CONTRACTORS, seedContractorRecords } from '../src/lib/provisioning';

const REQUIRED_ENV_VARS = [
  'AUTH0_DOMAIN',
  'AUTH0_CLIENT_ID',
  'AUTH0_CLIENT_SECRET',
  'AUTH0_SECRET',
  'APP_BASE_URL',
  'APP_API_AUDIENCE',
  'MCP_API_AUDIENCE',
  'OBO_BACKEND_CLIENT_ID',
  'OBO_BACKEND_CLIENT_SECRET',
  'OBO_CASE_SERVICE_CLIENT_ID',
  'OBO_CASE_SERVICE_CLIENT_SECRET',
  'CASE_SERVICE_AUDIENCE',
  'CASE_SERVICE_URL',
  'FGA_API_URL',
  'FGA_STORE_ID',
  'FGA_CLIENT_ID',
  'FGA_CLIENT_SECRET',
  'FGA_API_TOKEN_ISSUER',
  'FGA_API_AUDIENCE',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_MODEL',
  'PROVISIONING_SYNC_SECRET',
];

function step(n: number, label: string) {
  console.log(`\n[${n}/6] ${label}`);
}

function checkEnv(): void {
  step(1, 'Checking required environment variables');
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars (see ENV_TEMPLATE.md): ${missing.join(', ')}\n` +
        `Copy ENV_TEMPLATE.md to .env.local and fill in every value before running setup.`,
    );
  }
  console.log(`  All ${REQUIRED_ENV_VARS.length} required env vars are set.`);
}

function pushFgaModel(): void {
  step(2, 'Pushing the FGA model');
  // The SDK's writeAuthorizationModel expects the parsed JSON model, not
  // the raw DSL - `@openfga/sdk`'s CLI-adjacent helper transformer isn't
  // exposed for a plain writeAuthorizationModel call, so this goes via
  // the fga CLI (already a real dependency of this project's tenant
  // setup per the FGA store creation step in README) rather than
  // hand-rolling a DSL-to-JSON transform here.
  //
  // Not idempotent in the strict sense (flagged in adversarial review,
  // 2026-09-22): OpenFGA writes a NEW model version on every call rather
  // than updating in place, so re-running setup churns model-version
  // history even when fga-model.fga hasn't changed. Safe to re-run
  // (never duplicates tuples or breaks existing checks - old versions
  // stay valid), just not a true no-op. If FGA_MODEL_ID is pinned in
  // your env rather than left to resolve to "latest," re-run setup and
  // then update FGA_MODEL_ID to the new version if you want checks to
  // use it.
  try {
    execFileSync('fga', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'The `fga` CLI is required to push fga-model.fga (https://github.com/openfga/cli). Install it, then re-run this script.\n' +
        'Alternatively, push the model manually via https://dashboard.fga.dev and set FGA_MODEL_ID yourself.',
    );
  }
  execFileSync(
    'fga',
    [
      'model',
      'write',
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
      '--file',
      resolve(__dirname, '../fga-model.fga'),
    ],
    { stdio: 'inherit' },
  );
  console.log('  FGA model pushed. If FGA_MODEL_ID isn\'t already pinned in your env, the store will use the latest version by default.');
}

type Auth0Action = { id: string; name: string };

function ensureAction(name: string, triggerId: string, codePath: string, secrets: Record<string, string>): void {
  const existing = auth0Json<Auth0Action[]>(['actions', 'list', '--query', JSON.stringify({ triggerId })]);
  const found = existing.find((a) => a.name === name);
  const secretArgs = Object.entries(secrets).flatMap(([k, v]) => ['--secret', `${k}=${v}`]);

  if (found) {
    console.log(`  Action "${name}" already exists (${found.id}) - updating code + secrets.`);
    auth0([
      'actions',
      'update',
      found.id,
      '--code',
      readFileSync(codePath, 'utf8'),
      ...secretArgs,
    ]);
    auth0(['actions', 'deploy', found.id]);
  } else {
    console.log(`  Creating Action "${name}".`);
    const created = auth0Json<Auth0Action>([
      'actions',
      'create',
      '--name',
      name,
      '--trigger',
      triggerId,
      '--code',
      readFileSync(codePath, 'utf8'),
      ...secretArgs,
    ]);
    auth0(['actions', 'deploy', created.id]);
    console.log(
      `  Created and deployed - still needs binding to the ${triggerId} flow via the Auth0 dashboard ` +
        '(Actions -> Flows -> Login), since the CLI has no flow-binding command.',
    );
  }
}

async function ensureAuth0Tenant(): Promise<void> {
  step(3, 'Checking/creating Auth0 tenant resources (Applications, APIs, roles, Actions)');
  requireAuth0Cli();

  type Role = { id: string; name: string };
  const roles = auth0Json<Role[]>(['roles', 'list']);
  const roleNames = ['citizen', 'caseworker', 'dev-tools'];
  for (const roleName of roleNames) {
    if (roles.find((r) => r.name === roleName)) {
      console.log(`  Role "${roleName}" already exists.`);
    } else {
      console.log(`  Creating role "${roleName}".`);
      auth0(['roles', 'create', '--name', roleName, '--description', `SmartGov ${roleName} role`]);
    }
  }

  type Api = { id: string; identifier: string };
  const apis = auth0Json<Api[]>(['apis', 'list']);
  const requiredApis: Array<{ identifier: string; name: string }> = [
    { identifier: process.env.APP_API_AUDIENCE!, name: 'SmartGov App API' },
    { identifier: process.env.MCP_API_AUDIENCE!, name: 'SmartGov MCP API' },
    { identifier: process.env.CASE_SERVICE_AUDIENCE!, name: 'SmartGov Case Service' },
  ];
  for (const api of requiredApis) {
    if (apis.find((a) => a.identifier === api.identifier)) {
      console.log(`  API "${api.identifier}" already registered.`);
    } else {
      console.log(`  Registering API "${api.identifier}".`);
      auth0(['apis', 'create', '--name', api.name, '--identifier', api.identifier]);
    }
  }

  console.log(
    '  Applications (citizen portal + two OBO resource_server clients) and Connections are NOT ' +
      'auto-created here - their setup requires values (callback URLs, social/passkey connection ' +
      'choices) this script has no basis to invent safely. Follow README "Deploying your own copy" ' +
      'step 1 for those, then re-run this script - Actions below are safe to (re-)run either way.',
  );

  const secretsShared = { DOMAIN: process.env.AUTH0_DOMAIN! };
  ensureAction(
    'Assign Persona Role',
    'post-login',
    resolve(__dirname, '../auth0-actions/assign-persona-role.js'),
    {
      ...secretsShared,
      // CITIZEN_ROLE_ID/CASEWORKER_ROLE_ID/CLIENT_ID/CLIENT_SECRET aren't
      // derivable here (role IDs need a second `auth0 roles list --json`
      // pass after creation above; the Management API client is a
      // separate manual credential) - left for whoever's running setup
      // to fill in via the dashboard's Action editor once, same as
      // ENV_TEMPLATE.md's own documented gaps for these.
    },
  );
  ensureAction(
    'Provision Citizen Record',
    'post-login',
    resolve(__dirname, '../auth0-actions/provision-citizen-record.js'),
    {
      PROVISIONING_SYNC_URL: `${process.env.APP_BASE_URL}/api/provisioning/sync`,
      PROVISIONING_SYNC_SECRET: process.env.PROVISIONING_SYNC_SECRET!,
    },
  );
}

async function confirmFgaClientReachable(): Promise<void> {
  step(4, 'Confirming the app\'s own FGA SDK client (not just the fga CLI) can reach the store');
  await getFgaClient().listStores();
  console.log('  FGA store reachable via the SDK client.');
}

async function seedContractors(): Promise<void> {
  step(5, 'Seeding mock contractor records');
  await seedContractorRecords();
  console.log(`  Seeded ${CONTRACTORS.length} contractor records.`);
}

function reminders(): void {
  step(6, 'Manual steps still required (not scriptable safely)');
  console.log(
    [
      '  - Deploy firestore.rules: firebase deploy --only firestore:rules (needs firebase login + firebase use)',
      '  - Fill in CITIZEN_ROLE_ID/CASEWORKER_ROLE_ID/CLIENT_ID/CLIENT_SECRET Action Secrets on "Assign Persona Role" via the dashboard',
      '  - Bind both post-login Actions to the Login flow (Auth0 dashboard -> Actions -> Flows -> Login)',
      '  - Agent-as-Principal registration (agent_id + agent_subject_claims), if wanted - see the build plan\'s resolved "agent as principal" item',
      '  - Deploy the app via a GitHub push, never `vercel deploy`/`--prod` directly',
    ].join('\n'),
  );
}

async function main() {
  checkEnv();
  pushFgaModel();
  await confirmFgaClientReachable();
  await ensureAuth0Tenant();
  await seedContractors();
  reminders();
  console.log('\nSetup complete (see manual steps above).');
}

main().catch((err) => {
  console.error('\nSetup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
