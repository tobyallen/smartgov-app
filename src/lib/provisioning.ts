import { firestore } from './firebase-admin';
import { getFgaClient } from './fga';

export function agentIdFor(userId: string) {
  return `agent:${userId}-assistant`;
}

export function caseIdFor(caseRowId: string) {
  return `case:${caseRowId}`;
}

export type CaseRecord = {
  id: string;
  citizenUserId: string;
  assessmentTime: Date;
  status: string;
  createdAt: Date;
  // Set/cleared by setAgentDelegation on grant/revoke - never written here.
  // Read back at check time to evaluate the delegation_window FGA
  // condition, the same pattern assessmentTime already follows for
  // appeal_window: FGA conditions take real values from the caller, not
  // from anything stored on the tuple itself.
  delegationGrantedAt: Date | null;
};

export type AgentRecord = {
  id: string;
  citizenUserId: string;
  fgaAgentId: string;
  createdAt: Date;
};

export type AuditEventRecord = {
  id: string;
  onBehalfOf: string; // whose event this is - the beneficiary, not necessarily the actor
  eventType: 'check' | 'tuple_write' | 'tuple_delete' | 'obo_exchange';
  actingPrincipal: string; // who/what actually performed the action - 'user:...' or 'agent:...'
  relation: string | null;
  object: string | null;
  context: Record<string, unknown> | null;
  decision: boolean | null;
  detail: Record<string, unknown> | null;
  // Real Auth0 agent identity (act.sub) verified from the request token,
  // distinct from actingPrincipal above (FGA's per-citizen agentIdFor()
  // string) - see lib/mcpAuth.ts. null pre-EA or when absent from the token.
  verifiedActor: string | null;
  createdAt: Date;
};

export async function findCaseByCitizen(citizenUserId: string): Promise<CaseRecord | undefined> {
  const doc = await firestore().collection('cases').doc(citizenUserId).get();
  if (!doc.exists) return undefined;
  const data = doc.data()!;
  return {
    id: doc.id,
    citizenUserId: data.citizenUserId,
    assessmentTime: data.assessmentTime.toDate(),
    status: data.status,
    createdAt: data.createdAt.toDate(),
    delegationGrantedAt: data.delegationGrantedAt?.toDate() ?? null,
  };
}

export async function findCaseById(caseId: string): Promise<CaseRecord | undefined> {
  const doc = await firestore().collection('cases').doc(caseId).get();
  if (!doc.exists) return undefined;
  const data = doc.data()!;
  return {
    id: doc.id,
    citizenUserId: data.citizenUserId,
    assessmentTime: data.assessmentTime.toDate(),
    status: data.status,
    createdAt: data.createdAt.toDate(),
    delegationGrantedAt: data.delegationGrantedAt?.toDate() ?? null,
  };
}

/**
 * Runs once per citizen, on first login: creates their mock case + agent
 * identity, and writes the `owner` FGA tuple. Idempotent — safe to call
 * on every login, including concurrently from two tabs/devices for the
 * same brand-new user: both `cases` and `agents` use the citizen's own
 * uid as the document ID (not an auto-generated one), so a second
 * concurrent create overwrites the first with equivalent data rather
 * than racing to insert a duplicate row under a different ID.
 */
export async function ensureCitizenProvisioned(
  userId: string,
): Promise<{ case: CaseRecord; agent: AgentRecord }> {
  const db = firestore();
  const existingCase = await findCaseByCitizen(userId);
  const existingAgentDoc = await db.collection('agents').doc(userId).get();

  if (existingCase && existingAgentDoc.exists) {
    const agentData = existingAgentDoc.data()!;
    return {
      case: existingCase,
      agent: {
        id: existingAgentDoc.id,
        citizenUserId: agentData.citizenUserId,
        fgaAgentId: agentData.fgaAgentId,
        createdAt: agentData.createdAt.toDate(),
      },
    };
  }

  // Case exists but the agent doc doesn't (or vice versa) — a prior
  // provisioning attempt was interrupted partway through. Re-run the
  // whole thing; every write below is a deterministic-ID set(), so
  // re-provisioning an already-complete half is a harmless overwrite,
  // not a duplicate. Each doc keeps its own original createdAt if it
  // already existed, rather than both being stamped with whichever
  // timestamp happened to be computed first.
  const now = new Date();
  const caseCreatedAt = existingCase?.createdAt ?? now;
  const agentCreatedAt = existingAgentDoc.exists
    ? (existingAgentDoc.data()!.createdAt.toDate() as Date)
    : now;

  await db.collection('cases').doc(userId).set({
    citizenUserId: userId,
    assessmentTime: existingCase?.assessmentTime ?? now,
    status: existingCase?.status ?? 'open',
    createdAt: caseCreatedAt,
    // Preserve an existing grant across a re-provisioning replay (this
    // runs as a lazy fallback from other pages too, not just first
    // login) - a bare overwrite here would silently un-delegate a
    // citizen who already granted access, with no toggle click to blame.
    delegationGrantedAt: existingCase?.delegationGrantedAt ?? null,
  });

  const fgaAgentId = agentIdFor(userId);
  await db.collection('agents').doc(userId).set({
    citizenUserId: userId,
    fgaAgentId,
    createdAt: agentCreatedAt,
  });

  // Only write the `owner` tuple if the case doc didn't already exist —
  // FGA's write API errors on a duplicate tuple rather than no-op'ing,
  // so re-running this on the "case exists, agent doc was missing"
  // recovery path must not attempt to rewrite a tuple that's already
  // there.
  if (!existingCase) {
    await getFgaClient().write({
      writes: [
        { user: `user:${userId}`, relation: 'owner', object: caseIdFor(userId) },
      ],
    });
  }

  return {
    case: {
      id: userId,
      citizenUserId: userId,
      assessmentTime: existingCase?.assessmentTime ?? now,
      status: existingCase?.status ?? 'open',
      createdAt: caseCreatedAt,
      delegationGrantedAt: existingCase?.delegationGrantedAt ?? null,
    },
    agent: { id: userId, citizenUserId: userId, fgaAgentId, createdAt: agentCreatedAt },
  };
}

const CONTRACTORS = [
  { id: 'contractor-1', name: 'Riverside Grounds Maintenance' },
  { id: 'contractor-2', name: 'Northside Waste Collection' },
  { id: 'contractor-3', name: 'Civic Hall Security Services' },
  { id: 'contractor-4', name: 'Metro Road Resurfacing Co' },
  { id: 'contractor-5', name: 'Parks & Playgrounds Ltd' },
];

/**
 * Runs once per caseworker, on first login: seeds the shared mock
 * contractor records (idempotent - same deterministic ids every time, a
 * harmless overwrite on replay) and grants this caseworker's
 * caseworker_managed / caseworker_can_bulk_disable FGA tuples on all of
 * them. Without this, bulk_disable_contractors and disable_contractor
 * deny unconditionally for every caseworker until someone manually runs
 * scripts/seed-contractors.ts - which contradicts "a sent link should
 * just work." Contractors themselves are shared/global, not
 * per-caseworker, to avoid duplicating the same 5 mock records for every
 * signup; only the FGA grants are caseworker-specific.
 */
export async function ensureCaseworkerProvisioned(caseworkerUserId: string): Promise<void> {
  const db = firestore();
  const fga = getFgaClient();

  for (const contractor of CONTRACTORS) {
    await db.collection('contractors').doc(contractor.id).set(
      { name: contractor.name, status: 'active' },
      { mergeFields: ['name'] }, // never stomp a status another caseworker already changed
    );
  }

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
  }

  const alreadyBulkGranted = await grantedObjectsFor('caseworker_can_bulk_disable');
  const bulkWrites = CONTRACTORS.filter((c) => !alreadyBulkGranted.has(`contractor:${c.id}`)).map((c) => ({
    user: `user:${caseworkerUserId}`,
    relation: 'caseworker_can_bulk_disable',
    object: `contractor:${c.id}`,
    condition: { name: 'step_up_approved', context: {} },
  }));
  if (bulkWrites.length > 0) {
    await fga.write({ writes: bulkWrites });
  }
}
