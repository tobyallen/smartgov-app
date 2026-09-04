import { checkAppealWindow, checkDelegation } from './fga';
import { agentIdFor, caseIdFor, findCaseByCitizen } from './provisioning';
import { exchangeForCaseService } from './obo';

export type TraceEvent = {
  kind: 'fga_check' | 'obo_exchange';
  label: string;
  allowed?: boolean;
  // Only ever set on kind: 'obo_exchange' - the raw exchanged JWT, for
  // the debug-oriented trace card to decode and display (aud/sub/act
  // claims). This token is never persisted anywhere else; it only ever
  // exists for the duration of the request that minted it, so this is
  // the sole place a viewer can see it at all.
  token?: string;
};

export type ToolContext = {
  citizenUserId: string;
  citizenAccessToken: string; // needed only by submitAppeal, for the OBO exchange
  trace: (event: TraceEvent) => void;
};

/**
 * The single set of tool handlers, exposed two ways: as a real MCP
 * server (src/app/api/mcp/route.ts, Streamable HTTP — so any MCP client
 * can point at it) and directly wired into the chat route's tool-calling
 * (avoiding an extra HTTP hop on the hot path every attendee uses).
 */

export async function checkCaseStatus(ctx: ToolContext) {
  const row = await findCaseByCitizen(ctx.citizenUserId);
  if (!row) return { error: 'No case found.' };

  const agentId = agentIdFor(ctx.citizenUserId);
  const caseId = caseIdFor(row.id);

  const allowed = await checkDelegation({
    onBehalfOf: ctx.citizenUserId,
    agentId,
    caseId,
    delegationGrantedAt: row.delegationGrantedAt,
  });
  ctx.trace({ kind: 'fga_check', label: `agent_delegate on ${caseId}`, allowed });

  if (!allowed) {
    return { error: 'Your assistant is not delegated access to this case yet (or the delegation has expired).' };
  }

  return { caseId: row.id, status: row.status, assessmentTime: row.assessmentTime };
}

export async function submitAppeal(ctx: ToolContext) {
  const row = await findCaseByCitizen(ctx.citizenUserId);
  if (!row) return { error: 'No case found.' };

  const agentId = agentIdFor(ctx.citizenUserId);
  const caseId = caseIdFor(row.id);

  const allowed = await checkAppealWindow({
    onBehalfOf: ctx.citizenUserId,
    agentId,
    caseId,
    assessmentTime: row.assessmentTime,
  });
  ctx.trace({ kind: 'fga_check', label: `agent_can_submit_appeal on ${caseId}`, allowed });

  if (!allowed) {
    return { error: 'Denied — either delegation is off, or the appeal window has closed.' };
  }

  const exchangedToken = await exchangeForCaseService({
    citizenUserId: ctx.citizenUserId,
    citizenAccessToken: ctx.citizenAccessToken,
  });
  ctx.trace({
    kind: 'obo_exchange',
    label: 'Exchanging token to act on your behalf for the Case Service',
    token: exchangedToken,
  });

  const response = await fetch(`${process.env.CASE_SERVICE_URL}/submit-appeal`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${exchangedToken}` },
    body: JSON.stringify({ caseId: row.id }),
  });

  if (!response.ok) {
    return { error: `Case Service denied the request: ${response.status}` };
  }

  return { submitted: true };
}
