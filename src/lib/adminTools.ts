import { checkAndLog, checkStepUpBulkDisable, getFgaClient } from './fga';
import { firestore } from './firebase-admin';
import type { TraceEvent } from './tools';

export type ContractorRecord = {
  id: string;
  name: string;
  status: 'active' | 'disabled';
};

export type AdminToolContext = {
  caseworkerUserId: string;
  trace: (event: TraceEvent) => void;
};

function contractorIdFor(id: string) {
  return `contractor:${id}`;
}

/**
 * FGA-filtered, not just RBAC-gated: the RBAC gate (checked before this
 * is ever reachable in admin-mcp/admin-chat) decides whether contractor
 * tools exist for this caller AT ALL, but a caseworker who does have the
 * tools should still only see the specific contractors they have a real
 * caseworker_managed grant on - the same "role decides visibility of the
 * tool, FGA decides visibility of the specific record" split the citizen
 * side already demonstrates. Uses FGA's listObjects (one bulk query)
 * rather than N individual checkAndLog calls per contractor, since this
 * needs to filter a list, not gate a single action.
 */
export async function listContractors(ctx: AdminToolContext) {
  const { objects } = await getFgaClient().listObjects({
    type: 'contractor',
    relation: 'caseworker_managed',
    user: `user:${ctx.caseworkerUserId}`,
  });
  const managedIds = new Set(objects.map((o) => o.split(':')[1]));
  ctx.trace({
    kind: 'fga_check',
    label: `caseworker_managed listObjects (${managedIds.size} contractor(s) visible)`,
    allowed: managedIds.size > 0,
  });

  const snapshot = await firestore().collection('contractors').get();
  return snapshot.docs
    .filter((doc) => managedIds.has(doc.id))
    .map((doc) => {
      const data = doc.data();
      return { id: doc.id, name: data.name, status: data.status } as ContractorRecord;
    });
}

export async function disableContractor(ctx: AdminToolContext, contractorId: string) {
  const allowed = await checkAndLog({
    onBehalfOf: ctx.caseworkerUserId,
    actingPrincipal: `user:${ctx.caseworkerUserId}`,
    relation: 'caseworker_managed',
    object: contractorIdFor(contractorId),
  });
  ctx.trace({
    kind: 'fga_check',
    label: `caseworker_managed on ${contractorIdFor(contractorId)}`,
    allowed,
  });

  if (!allowed) {
    return { error: `Not authorized to manage contractor ${contractorId}.` };
  }

  await firestore().collection('contractors').doc(contractorId).set({ status: 'disabled' }, { merge: true });
  return { contractorId, status: 'disabled' as const };
}

/**
 * Every contractor id is checked individually against
 * caseworker_can_bulk_disable (not just gated once for the whole batch) —
 * a caseworker's step-up approval is real, but which specific contractors
 * they manage still varies per record. Partial failure is reported
 * structurally, not silently dropped: the caller (chat model or MCP
 * client) needs to know which ids actually changed.
 */
export async function bulkDisableContractors(ctx: AdminToolContext, contractorIds: string[]) {
  const approvalDoc = await firestore().collection('stepUpApprovals').doc(ctx.caseworkerUserId).get();
  if (!approvalDoc.exists) {
    return {
      error: 'No step-up approval on file. Call request_step_up first.',
      disabled: [],
      denied: contractorIds,
    };
  }
  const approvedAt = (approvalDoc.data()!.approvedAt as { toDate(): Date }).toDate();

  const disabled: string[] = [];
  const denied: string[] = [];

  for (const contractorId of contractorIds) {
    const allowed = await checkStepUpBulkDisable({
      caseworkerUserId: ctx.caseworkerUserId,
      contractorId,
      approvedAt,
    });
    ctx.trace({
      kind: 'fga_check',
      label: `caseworker_can_bulk_disable on ${contractorIdFor(contractorId)}`,
      allowed,
    });

    if (!allowed) {
      denied.push(contractorId);
      continue;
    }

    await firestore().collection('contractors').doc(contractorId).set({ status: 'disabled' }, { merge: true });
    disabled.push(contractorId);
  }

  return { disabled, denied };
}
