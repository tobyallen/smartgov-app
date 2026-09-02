import { OpenFgaClient, CredentialsMethod } from '@openfga/sdk';
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
    const result = await getFgaClient().check({
      user: actingPrincipal,
      relation,
      object,
      context,
    });
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
 * Writes/deletes BOTH relations together: `agent_delegate` (plain, gates
 * chat/view/most tool calls) and `agent_can_submit_appeal` (conditioned
 * on appeal_window, gates only the submit_appeal tool). One toggle,
 * one action — the two-relation split is an internal modeling detail,
 * not something the citizen needs to reason about.
 */
export async function setAgentDelegation(
  { onBehalfOf, agentId, caseId }: DelegationArgs,
  granted: boolean,
) {
  // agent_can_submit_appeal's relation type is `[agent with appeal_window]`
  // — the model requires every tuple written for it to explicitly declare
  // that condition, even though we deliberately store no context on the
  // tuple itself (current_time/assessment_time are supplied fresh at
  // check time from our own Firestore data, not from FGA tuple storage).
  const writeKeys = [
    { user: agentId, relation: 'agent_delegate', object: caseId },
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

  await getFgaClient().write(granted ? { writes: writeKeys } : { deletes: deleteKeys });

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
