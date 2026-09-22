import { NextRequest, NextResponse } from 'next/server';
import { ClientWriteRequestOnMissingDeletes } from '@openfga/sdk';
import { auth0 } from '@/lib/auth0';
import { hasDevToolsRole } from '@/lib/roles';
import { getFgaClient } from '@/lib/fga';
import { firestore } from '@/lib/firebase-admin';
import { agentIdFor, caseIdFor, CONTRACTORS, seedContractorRecords } from '@/lib/provisioning';

/**
 * POST /api/dev/reset — clears a citizen's own case/agent/audit state so
 * they can replay the walkthrough fresh, per the build plan's "Reruns"
 * section. Own-data reset is enabled for every authenticated user on
 * every deployment, including public ones - it's genuinely safe, since
 * it can only ever affect the caller's own uid, never anyone else's.
 * The cross-user (`targetUserId`) and contractor-reset paths require
 * the `dev-tools` role, which (per the build plan) has no self-service
 * grant path anywhere in this app - that's what keeps them from needing
 * a separate env-var/deployment gate. A `dev-tools` account with a
 * stale session can still use those paths until its token/session
 * expires - the same latency any role-based claim has in this app (see
 * roles.ts's own comment on personaFor) - acceptable here since this is
 * a rehearsal tool a single operator controls, not a public capability.
 */
export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (rawBody.targetUserId !== undefined && typeof rawBody.targetUserId !== 'string') {
    return NextResponse.json({ error: 'targetUserId must be a string' }, { status: 400 });
  }
  if (rawBody.resetContractors !== undefined && typeof rawBody.resetContractors !== 'boolean') {
    return NextResponse.json({ error: 'resetContractors must be a boolean' }, { status: 400 });
  }
  const body = rawBody as { targetUserId?: string; resetContractors?: boolean };

  const callerIsDevTools = hasDevToolsRole(session);
  if ((body.targetUserId || body.resetContractors) && !callerIsDevTools) {
    return NextResponse.json(
      { error: 'targetUserId and resetContractors require the dev-tools role' },
      { status: 403 },
    );
  }

  // Never inferred/defaulted to anyone else - a targetUserId is only
  // ever honoured for a caller who already passed the dev-tools check
  // above, and even then only the value explicitly supplied, never a
  // fallback to "someone other than the caller."
  const targetUserId = callerIsDevTools && body.targetUserId ? body.targetUserId : session.user.sub;

  const citizenResult = await resetCitizenData(targetUserId);

  let contractorResult: { failed: string[] } | undefined;
  if (callerIsDevTools && body.resetContractors) {
    contractorResult = await resetContractorSeed();
  }

  // Structured result rather than a bare {reset:true} - this is a
  // multi-step destructive operation across two systems (FGA, Firestore)
  // with no rollback; a caller relying on this for rehearsal reliability
  // needs to know if a specific piece didn't clear, not just get a
  // blanket success.
  const anyFailures = citizenResult.failed.length > 0 || (contractorResult?.failed.length ?? 0) > 0;
  return NextResponse.json(
    {
      reset: !anyFailures,
      targetUserId,
      citizen: citizenResult,
      contractors: contractorResult ?? null,
    },
    { status: anyFailures ? 207 : 200 },
  );
}

async function resetCitizenData(userId: string): Promise<{ failed: string[] }> {
  const db = firestore();
  const fga = getFgaClient();
  const agentId = agentIdFor(userId);
  const caseId = caseIdFor(userId);
  const failed: string[] = [];

  // Delete-then-nothing, not delete-then-write - unlike
  // setAgentDelegation's grant path in lib/fga.ts, a reset never
  // re-writes anything; ensureCitizenProvisioned's existing lazy
  // fallback (already called from /case and /chat) is what re-creates a
  // fresh case/agent/owner tuple on next visit, so there's one
  // provisioning code path, not two. onMissingDeletes: 'ignore' matches
  // the same reasoning setAgentDelegation already documents - a delete
  // of a tuple that was never granted (e.g. delegation was off at reset
  // time) must not error.
  try {
    await fga.deleteTuples(
      [
        { user: `user:${userId}`, relation: 'owner', object: caseId },
        { user: agentId, relation: 'agent_delegate', object: caseId },
        { user: agentId, relation: 'agent_can_submit_appeal', object: caseId },
      ],
      { conflict: { onMissingDeletes: ClientWriteRequestOnMissingDeletes.Ignore } },
    );
  } catch {
    failed.push('fga_tuples');
  }

  // Independent per-doc deletes, run concurrently and individually
  // caught (adversarial review, 2026-09-22): a single failure (e.g. one
  // doc momentarily locked by a concurrent write) must not abort the
  // rest and must not throw a bare 500 with no indication of what did
  // and didn't clear - this is a rehearsal tool, and "reset partially
  // worked" needs to be visible to the operator, not silently total.
  // stepUpApprovals is keyed by uid exactly like cases/agents
  // (src/app/api/request-step-up/route.ts) but was missed in the first
  // version of this route - a caseworker's stale step-up approval would
  // otherwise survive a reset and skip the step-up flow on replay.
  const perDocDeletes: Array<[string, () => Promise<unknown>]> = [
    ['cases', () => db.collection('cases').doc(userId).delete()],
    ['agents', () => db.collection('agents').doc(userId).delete()],
    ['mcpTokenCache', () => db.collection('mcpTokenCache').doc(userId).delete()],
    ['stepUpApprovals', () => db.collection('stepUpApprovals').doc(userId).delete()],
  ];
  const results = await Promise.allSettled(perDocDeletes.map(([, fn]) => fn()));
  results.forEach((result, i) => {
    if (result.status === 'rejected') failed.push(perDocDeletes[i][0]);
  });

  // Matches /access-log's own query shape (src/app/access-log/page.tsx)
  // - onBehalfOf is "whose event this is," the same field that page
  // scopes by, not actingPrincipal (which for agent-mediated events is
  // the agent id string, not the citizen's own sub). Best-effort under
  // concurrency: an audit event written for this user between this
  // query and the deletes below survives - acceptable for a rehearsal
  // tool where nobody is also mid-chat as the same user while resetting.
  try {
    const auditSnap = await db.collection('auditEvents').where('onBehalfOf', '==', userId).get();
    const auditResults = await Promise.allSettled(auditSnap.docs.map((doc) => doc.ref.delete()));
    if (auditResults.some((r) => r.status === 'rejected')) failed.push('auditEvents');
  } catch {
    failed.push('auditEvents');
  }

  return { failed };
}

async function resetContractorSeed(): Promise<{ failed: string[] }> {
  const fga = getFgaClient();
  const failed: string[] = [];

  // Every caseworker's grants on every contractor - not scoped to one
  // uid, since this route has no single target caseworker in view here
  // (unlike resetCitizenData, which always has exactly one userId).
  // Iterates each known contractor id explicitly (fixed after
  // adversarial review, 2026-09-22) rather than reading with a
  // type-only `object: 'contractor:'` filter and no `user` - that
  // specific combination isn't one of OpenFGA's documented Read
  // parameter combinations (user+relation+object-type IS documented and
  // used elsewhere in this codebase via grantedObjectsFor() in
  // provisioning.ts, but that always supplies a user; omitting user
  // entirely alongside a type-only object was unverified and risked
  // either an API error or a silently-empty result).
  for (const contractor of CONTRACTORS) {
    for (const relation of ['caseworker_managed', 'caseworker_can_bulk_disable']) {
      try {
        const { tuples } = await fga.read({ relation, object: `contractor:${contractor.id}` });
        if (tuples.length === 0) continue;
        await fga.deleteTuples(
          tuples.map((t) => ({ user: t.key.user, relation: t.key.relation, object: t.key.object })),
          { conflict: { onMissingDeletes: ClientWriteRequestOnMissingDeletes.Ignore } },
        );
      } catch {
        failed.push(`${relation}:${contractor.id}`);
      }
    }
  }

  // Re-seed the mock records themselves (name/status). Each caseworker's
  // own next /admin visit re-runs ensureCaseworkerProvisioned lazily,
  // which re-grants both relations above against whatever this reseeds -
  // there's no self-service re-grant step needed here.
  try {
    await seedContractorRecords();
  } catch {
    failed.push('contractor_records');
  }

  return { failed };
}
