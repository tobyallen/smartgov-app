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
  const snap = await firestore()
    .collection('cases')
    .where('citizenUserId', '==', citizenUserId)
    .limit(1)
    .get();
  if (snap.empty) return undefined;
  const doc = snap.docs[0];
  const data = doc.data();
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
 * on every login.
 */
export async function ensureCitizenProvisioned(
  userId: string,
): Promise<{ case: CaseRecord; agent: AgentRecord }> {
  const existingCase = await findCaseByCitizen(userId);
  if (existingCase) {
    const agentSnap = await firestore()
      .collection('agents')
      .where('citizenUserId', '==', userId)
      .limit(1)
      .get();
    const agentDoc = agentSnap.docs[0];
    const agentData = agentDoc.data();
    return {
      case: existingCase,
      agent: {
        id: agentDoc.id,
        citizenUserId: agentData.citizenUserId,
        fgaAgentId: agentData.fgaAgentId,
        createdAt: agentData.createdAt.toDate(),
      },
    };
  }

  const db = firestore();
  const now = new Date();
  // Backdated so the appeal window (720h / 30 days) is open by default for
  // the live demo; the standalone/self-guided version behaves the same.
  const caseRef = await db.collection('cases').add({
    citizenUserId: userId,
    assessmentTime: now,
    status: 'open',
    createdAt: now,
  });

  const fgaAgentId = agentIdFor(userId);
  const agentRef = await db.collection('agents').add({
    citizenUserId: userId,
    fgaAgentId,
    createdAt: now,
  });

  await getFgaClient().write({
    writes: [
      { user: `user:${userId}`, relation: 'owner', object: caseIdFor(caseRef.id) },
    ],
  });

  return {
    case: { id: caseRef.id, citizenUserId: userId, assessmentTime: now, status: 'open', createdAt: now },
    agent: { id: agentRef.id, citizenUserId: userId, fgaAgentId, createdAt: now },
  };
}
