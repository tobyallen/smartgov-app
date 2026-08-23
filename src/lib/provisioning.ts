import { eq } from 'drizzle-orm';
import { db } from './db';
import { agents, cases } from './db/schema';
import { getFgaClient } from './fga';

export function agentIdFor(userId: string) {
  return `agent:${userId}-assistant`;
}

export function caseIdFor(caseRowId: string) {
  return `case:${caseRowId}`;
}

/**
 * Runs once per citizen, on first login: creates their mock case + agent
 * identity, and writes the `owner` FGA tuple. Idempotent — safe to call
 * on every login.
 */
export async function ensureCitizenProvisioned(userId: string) {
  const existingCase = await db.query.cases.findFirst({
    where: eq(cases.citizenUserId, userId),
  });
  if (existingCase) {
    const existingAgent = await db.query.agents.findFirst({
      where: eq(agents.citizenUserId, userId),
    });
    return { case: existingCase, agent: existingAgent! };
  }

  const [newCase] = await db
    .insert(cases)
    .values({
      citizenUserId: userId,
      // Backdated so the appeal window (720h / 30 days) is open by default
      // for the live demo; the standalone/self-guided version behaves the same.
      assessmentTime: new Date(),
    })
    .returning();

  const fgaAgentId = agentIdFor(userId);
  const [newAgent] = await db
    .insert(agents)
    .values({ citizenUserId: userId, fgaAgentId })
    .returning();

  await getFgaClient().write({
    writes: [
      { user: `user:${userId}`, relation: 'owner', object: caseIdFor(newCase.id) },
    ],
  });

  return { case: newCase, agent: newAgent };
}
