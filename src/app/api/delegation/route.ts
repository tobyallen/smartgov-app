import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { checkAndLog, setAgentDelegation } from '@/lib/fga';
import { agentIdFor, caseIdFor, findCaseByCitizen } from '@/lib/provisioning';

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const citizenUserId = session.user.sub;

  const row = await findCaseByCitizen(citizenUserId);
  if (!row) return NextResponse.json({ granted: false });

  const granted = await checkAndLog({
    onBehalfOf: citizenUserId,
    actingPrincipal: agentIdFor(citizenUserId),
    relation: 'agent_delegate',
    object: caseIdFor(row.id),
  });
  return NextResponse.json({ granted });
}

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { granted } = (await request.json()) as { granted: boolean };
  const citizenUserId = session.user.sub;

  const row = await findCaseByCitizen(citizenUserId);
  if (!row) return NextResponse.json({ error: 'No case found' }, { status: 404 });

  // Blocks on the FGA write completing before returning — the UI should
  // disable chat/tool actions while this request is in flight, so there's
  // no window where the toggle shows "on" but the tuple isn't written yet.
  await setAgentDelegation(
    { onBehalfOf: citizenUserId, agentId: agentIdFor(citizenUserId), caseId: caseIdFor(row.id) },
    granted,
  );

  return NextResponse.json({ granted });
}
