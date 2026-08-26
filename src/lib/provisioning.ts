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
};

export type AgentRecord = {
  id: string;
  citizenUserId: string;
  fgaAgentId: string;
  createdAt: Date;
};

export type AuditEventRecord = {
  id: string;
  citizenUserId: string;
  eventType: 'check' | 'tuple_write' | 'tuple_delete' | 'obo_exchange';
  subject: string;
  relation: string | null;
  object: string | null;
  context: Record<string, unknown> | null;
  decision: boolean | null;
  detail: Record<string, unknown> | null;
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
    },
    agent: { id: userId, citizenUserId: userId, fgaAgentId, createdAt: agentCreatedAt },
  };
}
