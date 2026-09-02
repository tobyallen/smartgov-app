import { NextRequest } from 'next/server';
import { streamText, tool, stepCountIs, type UIMessage, convertToModelMessages } from 'ai';
import { z } from 'zod';
import { auth0 } from '@/lib/auth0';
import { chatModel } from '@/lib/ai';
import { isCaseworker } from '@/lib/roles';
import { connectToMcpServer } from '@/lib/mcpClient';
import type { TraceEvent } from '@/lib/tools';

// RBAC gate: a citizen session never gets a tools map with
// disable_contractor/bulk_disable_contractors in it — the model isn't
// shown these tools exist, matching admin-mcp's list_tools filtering.
// Every handler also re-checks FGA itself regardless of this gate; the
// two layers are independent, not one shortcutting the other.
//
// A real MCP client, same as /api/chat: every tool call goes through an
// OBO exchange (caseworker's access token -> MCP_API_AUDIENCE) and a
// genuine HTTP request to /api/admin-mcp - see lib/mcpClient.ts.
export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (!isCaseworker(session)) {
    return new Response('Forbidden — caseworker role required', { status: 403 });
  }

  const caseworkerUserId = session.user.sub;
  const { token } = await auth0.getAccessToken();
  const { messages }: { messages: UIMessage[] } = await request.json();

  const traceEvents: TraceEvent[] = [];
  const trace = (event: TraceEvent) => traceEvents.push(event);

  // See src/app/api/chat/route.ts for why this can't be allowed to throw
  // unhandled - a failed exchange/connection used to crash the whole
  // request into a bare 500 with no explanation at all.
  let mcpClient: Awaited<ReturnType<typeof connectToMcpServer>> | null = null;
  let connectionError: string | null = null;
  try {
    mcpClient = await connectToMcpServer({
      userId: caseworkerUserId,
      accessToken: token,
      mcpPath: '/api/admin-mcp',
    });
    trace({ kind: 'obo_exchange', label: 'Exchanging token to reach the MCP server (MCP_API_AUDIENCE)' });
  } catch (err) {
    connectionError = err instanceof Error ? err.message : String(err);
    trace({ kind: 'obo_exchange', label: 'Exchanging token to reach the MCP server (MCP_API_AUDIENCE)', allowed: false });
  }

  async function callMcpTool(name: string, args: Record<string, unknown> = {}) {
    if (!mcpClient) {
      return { error: `Could not reach the MCP server: ${connectionError}` };
    }
    try {
      const response = await mcpClient.callTool({ name, arguments: args });
      const content = response.content as Array<{ type: string; text?: string }>;
      const raw = content[0]?.text ?? '{}';
      const { result, traceEvents: toolTraceEvents } = JSON.parse(raw) as {
        result: unknown;
        traceEvents: TraceEvent[];
      };
      for (const event of toolTraceEvents) trace(event);
      return result;
    } catch (err) {
      return { error: `MCP tool call failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const result = streamText({
    model: chatModel(),
    // See src/app/api/chat/route.ts for why this is required — without
    // it, a tool call's result never gets fed back for a follow-up
    // response, so e.g. "list the contractors" calls list_contractors
    // and then the reply just stops with no answer.
    stopWhen: stepCountIs(5),
    system:
      'You are a caseworker assistant for the SmartGov admin console. ' +
      'You can list contractors, disable one contractor at a time, or bulk-disable ' +
      'several at once. Bulk actions require a fresh step-up approval — if bulk_disable_contractors ' +
      'reports denied ids, tell the caseworker plainly that step-up is missing or expired, ' +
      'not that something is broken. ' +
      'Do not include <thinking> tags or any other visible reasoning in your response — ' +
      'respond only with your final answer to the user.',
    messages: await convertToModelMessages(messages),
    tools: {
      list_contractors: tool({
        description: 'List all contractors and their current status.',
        inputSchema: z.object({}),
        execute: async () => callMcpTool('list_contractors'),
      }),
      disable_contractor: tool({
        description: 'Disable a single contractor by id.',
        inputSchema: z.object({ contractorId: z.string() }),
        execute: async ({ contractorId }) => callMcpTool('disable_contractor', { contractorId }),
      }),
      bulk_disable_contractors: tool({
        description:
          'Disable multiple contractors at once. Requires a fresh step-up approval — ' +
          'call request_step_up first if this reports denied ids.',
        inputSchema: z.object({ contractorIds: z.array(z.string()) }),
        execute: async ({ contractorIds }) =>
          callMcpTool('bulk_disable_contractors', { contractorIds }),
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
