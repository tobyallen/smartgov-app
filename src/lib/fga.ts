import {
  ClientWriteRequestOnMissingDeletes,
  ConsistencyPreference,
  OpenFgaClient,
  CredentialsMethod,
} from '@openfga/sdk';
import { firestore } from './firebase-admin';

// Configured against Auth0 FGA's hosted endpoint (see ENV_TEMPLATE.md) —
// never a self-hosted OpenFGA instance. Constructed lazily: the SDK
// validates its config eagerly at construction time, which would
// otherwise throw during `next build`'s page-data collection (or on cold
// start) whenever env vars aren't set yet, for routes that don't even use it.
let _fgaClient: OpenFgaClient | undefined;
export function getFgaClient(): OpenFgaClient {
  if (!_fgaClient) {
    _fgaClient = new OpenFgaClient({
      apiUrl: process.env.FGA_API_URL!,
      storeId: process.env.FGA_STORE_ID!,
      authorizationModelId: process.env.FGA_MODEL_ID,
      credentials: {
        method: CredentialsMethod.ClientCredentials,
        config: {
          apiTokenIssuer: process.env.FGA_API_TOKEN_ISSUER!,
          apiAudience: process.env.FGA_API_AUDIENCE!,
          clientId: process.env.FGA_CLIENT_ID!,
          clientSecret: process.env.FGA_CLIENT_SECRET!,
        },
      },
    });
  }
  return _fgaClient;
}

type CheckArgs = {
  onBehalfOf: string; // whose event this is - the beneficiary, not necessarily the actor
  actingPrincipal: string; // 'user:...' or 'agent:...' - who/what is actually performing the action
  relation: string;
  object: string;
  context?: Record<string, unknown>;
};

/**
 * The one boundary every policy decision passes through — human case
 * views, agent chat replies, MCP tool calls, and (separately, via
 * logObo below) the OBO exchange. Fails closed: any FGA error is logged
 * as a denial, never silently allowed.
 */
export async function checkAndLog({
  onBehalfOf,
  actingPrincipal,
  relation,
  object,
  context,
}: CheckArgs): Promise<boolean> {
  let decision: boolean;
  try {
    // Without this, OpenFGA's default (MINIMIZE_LATENCY) is allowed to
    // serve a cached, stale result for however long the store's cache
    // TTL is - confirmed live: a citizen granted delegation, then had
    // check_case_status denied for 10-34 seconds afterward, well past
    // any plausible replication lag, because the check kept reading the
    // pre-grant cached answer. This app's check volume is trivial (a
    // handful of concurrent workshop attendees, not production QPS), so
    // there's no real latency cost to paying for a fresh read every
    // time - correctness right after a grant/revoke matters far more
    // here than shaving milliseconds off a check nobody's waiting on at
    // scale.
    const result = await getFgaClient().check(
      { user: actingPrincipal, relation, object, context },
      { consistency: ConsistencyPreference.HigherConsistency },
    );
    decision = result.allowed ?? false;
  } catch {
    decision = false; // fail closed
  }

  await firestore().collection('auditEvents').add({
    onBehalfOf,
    eventType: 'check',
    actingPrincipal,
    relation: relation ?? null,
    object: object ?? null,
    context: context ?? null,
    decision,
    detail: null,
    createdAt: new Date(),
  });

  return decision;
}

type DelegationArgs = {
  onBehalfOf: string;
  agentId: string; // 'agent:<userId>-assistant'
  caseId: string; // 'case:<uuid>'
};

/**
 * Grants or revokes the citizen's own agent access to their own case.
 * Writes/deletes BOTH relations together: `agent_delegate` (conditioned
 * on delegation_window - self-expires 15 minutes after grant) and
 * `agent_can_submit_appeal` (conditioned on appeal_window, gates only
 * the submit_appeal tool). One toggle, one action — the two-relation
 * split is an internal modeling detail, not something the citizen needs
 * to reason about.
 */
export async function setAgentDelegation(
  { onBehalfOf, agentId, caseId }: DelegationArgs,
  granted: boolean,
) {
  // Both relations' types require every tuple written for them to
  // explicitly declare their condition, even though we deliberately
  // store no context on the tuple itself — current_time/granted_at
  // (and current_time/assessment_time) are supplied fresh at check time
  // from our own Firestore data, not from FGA tuple storage.
  const writeKeys = [
    {
      user: agentId,
      relation: 'agent_delegate',
      object: caseId,
      condition: { name: 'delegation_window', context: {} },
    },
    {
      user: agentId,
      relation: 'agent_can_submit_appeal',
      object: caseId,
      condition: { name: 'appeal_window', context: {} },
    },
  ];
  // Deletes must reference the plain tuple key, without the condition
  // object — the API rejects a condition on delete.
  const deleteKeys = [
    { user: agentId, relation: 'agent_delegate', object: caseId },
    { user: agentId, relation: 'agent_can_submit_appeal', object: caseId },
  ];

  // Always delete first, even on grant - agent_delegate only started
  // carrying a condition once delegation_window was added to the model,
  // so anyone who'd already granted delegation before that change has a
  // stale, unconditioned tuple sitting for the exact same user/relation/
  // object. Writing the new conditioned tuple on top of it fails outright
  // ("cannot write a tuple which already exists"), a real production
  // 500 this caused once discovered - FGA treats condition as metadata
  // on an existing key, not something a write can change in place; per
  // OpenFGA's own docs the only way to change a tuple's condition is
  // delete-then-write. onMissingDeletes: 'ignore' makes this safe for
  // the common case too (no prior tuple at all, a citizen's first-ever
  // grant) - sequential rather than one transactional call, since mixing
  // the same key in both a request's writes and deletes arrays isn't
  // documented as supported and this app would rather fail closed
  // (still denied) than guess wrong about that.
  await getFgaClient().deleteTuples(deleteKeys, {
    conflict: { onMissingDeletes: ClientWriteRequestOnMissingDeletes.Ignore },
  });
  if (granted) {
    await getFgaClient().writeTuples(writeKeys);
  }

  // caseId is `case:<caseRowId>` (see caseIdFor) - strip the FGA type
  // prefix to get back the Firestore doc id, since cases are keyed by
  // the citizen's own uid, not the prefixed FGA object string.
  const caseRowId = caseId.replace(/^case:/, '');
  await firestore()
    .collection('cases')
    .doc(caseRowId)
    .set({ delegationGrantedAt: granted ? new Date() : null }, { merge: true });

  await firestore().collection('auditEvents').add({
    onBehalfOf,
    eventType: granted ? 'tuple_write' : 'tuple_delete',
    actingPrincipal: agentId,
    relation: 'agent_delegate,agent_can_submit_appeal',
    object: caseId,
    context: null,
    decision: null,
    detail: null,
    createdAt: new Date(),
  });
}

/**
 * The agent_delegate boundary specifically: mirrors checkAppealWindow's
 * pattern exactly. delegationGrantedAt comes from our own `cases`
 * Firestore doc (set by setAgentDelegation above), never from FGA-stored
 * tuple context - FGA only evaluates the condition against what's
 * supplied here. If no grant has ever been made, current_time is passed
 * equal to a zero-value granted_at so the condition evaluates false
 * (denied) rather than needing a special no-grant case in every caller.
 */
export async function checkDelegation({
  onBehalfOf,
  agentId,
  caseId,
  delegationGrantedAt,
}: {
  onBehalfOf: string;
  agentId: string;
  caseId: string;
  delegationGrantedAt: Date | null;
}): Promise<boolean> {
  return checkAndLog({
    onBehalfOf,
    actingPrincipal: agentId,
    relation: 'agent_delegate',
    object: caseId,
    context: {
      current_time: new Date().toISOString(),
      granted_at: (delegationGrantedAt ?? new Date(0)).toISOString(),
    },
  });
}

/**
 * Debug-only escape hatch for demo reliability: backdates
 * delegationGrantedAt far enough that delegation_window's condition
 * evaluates false on the very next check, without touching the FGA
 * tuple itself. Deliberately NOT the same as a real revoke
 * (setAgentDelegation with granted=false) - the agent_delegate tuple
 * stays written, so this demonstrates the condition itself failing
 * (the actual expiry mechanism), not a manual revoke standing in for it.
 * Lets a presenter trigger the "delegation just expired" moment on cue
 * instead of waiting out the real 15-minute window live.
 */
export async function expireDelegationNow({
  onBehalfOf,
  caseId,
}: {
  onBehalfOf: string;
  caseId: string;
}) {
  const caseRowId = caseId.replace(/^case:/, '');
  await firestore()
    .collection('cases')
    .doc(caseRowId)
    .set({ delegationGrantedAt: new Date(0) }, { merge: true });

  await firestore().collection('auditEvents').add({
    onBehalfOf,
    eventType: 'tuple_write',
    actingPrincipal: `user:${onBehalfOf}`,
    relation: null,
    object: caseId,
    context: null,
    decision: null,
    detail: { note: 'debug: delegation force-expired, tuple left in place' },
    createdAt: new Date(),
  });
}

/**
 * The revoke_appeal boundary: unlike submit_appeal (the agent, gated by
 * delegation + appeal_window), revoking is a citizen action taken
 * directly, never through the agent — so it checks the plain, unconditional
 * `owner` relation instead of agent_can_submit_appeal. A citizen can revoke
 * their own submitted appeal even with delegation off or the appeal window
 * closed, since owner never expires the way agent_delegate/
 * agent_can_submit_appeal do.
 */
export async function checkOwner({
  onBehalfOf,
  caseId,
}: {
  onBehalfOf: string;
  caseId: string;
}): Promise<boolean> {
  return checkAndLog({
    onBehalfOf,
    actingPrincipal: `user:${onBehalfOf}`,
    relation: 'owner',
    object: caseId,
  });
}

/**
 * Logs the actual revoke ACTION, separate from checkOwner's authorization
 * check above - without this, revoking an appeal and simply viewing the
 * case page produce identical access-log entries (both eventType: 'check',
 * relation: 'owner', on the same case), with no way to tell "I looked at
 * my case" apart from "I revoked my appeal." Mirrors how a delegation
 * grant/revoke already gets its own tuple_write/tuple_delete eventType,
 * distinct from the checks that gate it.
 */
export async function logAppealRevoked({
  onBehalfOf,
  caseId,
}: {
  onBehalfOf: string;
  caseId: string;
}) {
  await firestore().collection('auditEvents').add({
    onBehalfOf,
    eventType: 'status_change',
    actingPrincipal: `user:${onBehalfOf}`,
    relation: 'owner',
    object: caseId,
    context: null,
    decision: null,
    detail: { note: 'appeal revoked', from: 'appeal_submitted', to: 'open' },
    createdAt: new Date(),
  });
}

/**
 * The submit_appeal boundary specifically: delegation must be granted AND
 * the case must still be inside its appeal window. assessmentTime comes
 * from our own `cases` Firestore doc, not from FGA-stored tuple context —
 * FGA only evaluates the condition against what's supplied here.
 */
export async function checkAppealWindow({
  onBehalfOf,
  agentId,
  caseId,
  assessmentTime,
}: {
  onBehalfOf: string;
  agentId: string;
  caseId: string;
  assessmentTime: Date;
}): Promise<boolean> {
  return checkAndLog({
    onBehalfOf,
    actingPrincipal: agentId,
    relation: 'agent_can_submit_appeal',
    object: caseId,
    context: {
      current_time: new Date().toISOString(),
      assessment_time: assessmentTime.toISOString(),
    },
  });
}

/**
 * The bulk_disable_contractors boundary: caseworker_can_bulk_disable must
 * be granted AND that grant's step_up_approved condition must still be
 * live. approvedAt comes from the caseworker's own `stepUpApprovals`
 * Firestore doc (written by /api/request-step-up), never from the
 * caller's own request — mirrors checkAppealWindow's pattern exactly:
 * FGA only evaluates the condition against what's supplied here.
 */
export async function checkStepUpBulkDisable({
  caseworkerUserId,
  contractorId,
  approvedAt,
}: {
  caseworkerUserId: string;
  contractorId: string;
  approvedAt: Date;
}): Promise<boolean> {
  return checkAndLog({
    // checkAndLog's field is onBehalfOf - genuinely just "whose event
    // this is," not citizen-specific despite the app's citizen-first
    // origins. /access-log scopes by it regardless of persona, so a
    // caseworker's own uid belongs here the same way a citizen's does.
    onBehalfOf: caseworkerUserId,
    actingPrincipal: `user:${caseworkerUserId}`,
    relation: 'caseworker_can_bulk_disable',
    object: `contractor:${contractorId}`,
    context: {
      approved_at: approvedAt.toISOString(),
      current_time: new Date().toISOString(),
    },
  });
}

/** Logs the OBO token-exchange step itself (distinct from the FGA checks either side of it). */
export async function logOboExchange({
  onBehalfOf,
  detail,
}: {
  onBehalfOf: string;
  detail: Record<string, unknown>;
}) {
  await firestore().collection('auditEvents').add({
    onBehalfOf,
    eventType: 'obo_exchange',
    actingPrincipal: `user:${onBehalfOf}`,
    relation: null,
    object: null,
    context: null,
    decision: null,
    detail,
    createdAt: new Date(),
  });
}
