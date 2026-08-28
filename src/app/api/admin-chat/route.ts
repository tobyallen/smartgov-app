import { NextRequest } from 'next/server';
import { streamText, tool, type UIMessage, convertToModelMessages } from 'ai';
import { z } from 'zod';
import { auth0 } from '@/lib/auth0';
import { chatModel } from '@/lib/ai';
import { isCaseworker } from '@/lib/roles';
import { listContractors, disableContractor, bulkDisableContractors } from '@/lib/adminTools';
import type { TraceEvent } from '@/lib/tools';

// RBAC gate: a citizen session never gets a tools map with
// disable_contractor/bulk_disable_contractors in it — the model isn't
// shown these tools exist, matching admin-mcp's list_tools filtering.
// Every handler also re-checks FGA itself regardless of this gate; the
// two layers are independent, not one shortcutting the other.
export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (!isCaseworker(session.user)) {
    return new Response('Forbidden — caseworker role required', { status: 403 });
  }

  const caseworkerUserId = session.user.sub;
  const { messages }: { messages: UIMessage[] } = await request.json();

  const traceEvents: TraceEvent[] = [];
  const trace = (event: TraceEvent) => traceEvents.push(event);

  const result = streamText({
    model: chatModel(),
    system:
      'You are a caseworker assistant for the SmartGov admin console. ' +
      'You can list contractors, disable one contractor at a time, or bulk-disable ' +
      'several at once. Bulk actions require a fresh step-up approval — if bulk_disable_contractors ' +
      'reports denied ids, tell the caseworker plainly that step-up is missing or expired, ' +
      'not that something is broken.',
    messages: await convertToModelMessages(messages),
    tools: {
      list_contractors: tool({
        description: 'List all contractors and their current status.',
        inputSchema: z.object({}),
        execute: async () => listContractors({ caseworkerUserId, trace }),
      }),
      disable_contractor: tool({
        description: 'Disable a single contractor by id.',
        inputSchema: z.object({ contractorId: z.string() }),
        execute: async ({ contractorId }) =>
          disableContractor({ caseworkerUserId, trace }, contractorId),
      }),
      bulk_disable_contractors: tool({
        description:
          'Disable multiple contractors at once. Requires a fresh step-up approval — ' +
          'call request_step_up first if this reports denied ids.',
        inputSchema: z.object({ contractorIds: z.array(z.string()) }),
        execute: async ({ contractorIds }) =>
          bulkDisableContractors({ caseworkerUserId, trace }, contractorIds),
      }),
    },
    onFinish: async () => {
      // Same as /api/chat: traceEvents are already persisted individually
      // by checkAndLog as they happen. This array is only for rendering
      // trace cards inline in this response.
    },
  });

  return result.toUIMessageStreamResponse({
    messageMetadata: () => ({ traceEvents }),
  });
}
