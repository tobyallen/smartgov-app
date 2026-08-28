import { checkAndLog, checkStepUpBulkDisable } from './fga';
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
 * No FGA check on read — matches list_tools staying cheap. The RBAC gate
 * (isCaseworker, checked before this is ever reachable in admin-mcp/
 * admin-chat) is what keeps a citizen from calling this at all; once past
 * that gate, seeing which contractors exist isn't itself sensitive, only
 * acting on one is.
 */
export async function listContractors(ctx: AdminToolContext) {
  void ctx; // no FGA check on read; kept for signature parity with the other handlers
  const snapshot = await firestore().collection('contractors').get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { id: doc.id, name: data.name, status: data.status } as ContractorRecord;
  });
}

export async function disableContractor(ctx: AdminToolContext, contractorId: string) {
  const allowed = await checkAndLog({
    citizenUserId: ctx.caseworkerUserId,
    subject: `user:${ctx.caseworkerUserId}`,
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
