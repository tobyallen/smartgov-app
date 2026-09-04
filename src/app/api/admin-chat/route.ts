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

  // See src/app/api/chat/route.ts - getAccessToken() throws on an
  // expired/invalid refresh token, and left unhandled that crashes the
  // whole request into a bare 500 with no explanation, one step before
  // the MCP connect/exchange error handling below even gets a chance to run.
  let token: string;
  try {
    ({ token } = await auth0.getAccessToken());
  } catch {
    return Response.json(
      { error: 'Your session has expired. Please log out and log back in.' },
      { status: 401 },
    );
  }

  const { messages }: { messages: UIMessage[] } = await request.json();

  const traceEvents: TraceEvent[] = [];
  const trace = (event: TraceEvent) => traceEvents.push(event);

  // See src/app/api/chat/route.ts - golden-path buttons (AdminChat.tsx's
  // send()) submit this exact text; force the corresponding tool call
  // rather than risk the model answering from its own conversation
  // history instead of re-checking RBAC/FGA/step-up state.
  const lastUserText = [...messages].reverse().find((m) => m.role === 'user')
    ?.parts.find((p) => p.type === 'text')?.text;
  const forcedTool =
    lastUserText === 'List all contractors'
      ? 'list_contractors'
      : lastUserText === 'Disable contractor-1'
        ? 'disable_contractor'
        : lastUserText === 'Bulk disable contractor-2, contractor-3, and contractor-4'
          ? 'bulk_disable_contractors'
          : undefined;

  // See src/app/api/chat/route.ts for why this can't be allowed to throw
  // unhandled - a failed exchange/connection used to crash the whole
  // request into a bare 500 with no explanation at all.
  let mcpClient: Awaited<ReturnType<typeof connectToMcpServer>>['client'] | null = null;
  let connectionError: string | null = null;
  try {
    const connection = await connectToMcpServer({
      userId: caseworkerUserId,
      accessToken: token,
      mcpPath: '/api/admin-mcp',
    });
    mcpClient = connection.client;
    // See src/app/api/chat/route.ts - only a real event on a fresh
    // exchange, since exchangeForMcp caches the token across calls.
    if (connection.freshlyExchanged) {
      trace({
        kind: 'obo_exchange',
        label: 'Exchanging token to reach the MCP server (MCP_API_AUDIENCE)',
        token: connection.exchangedToken,
      });
    }
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
      // See src/app/api/chat/route.ts - surface the HTTP status code
      // separately when available, not just a generic message.
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : undefined;
      const message = err instanceof Error ? err.message : String(err);
      return { error: `MCP tool call failed${code ? ` (HTTP ${code})` : ''}: ${message}` };
    }
  }

  const result = streamText({
    model: chatModel(),
    // See src/app/api/chat/route.ts - toolChoice must be a per-step
    // override (prepareStep), forced only on step 1, not a top-level
    // setting that forces every step and leaves no room for a final
    // text-only answer.
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0 && forcedTool ? { toolChoice: { type: 'tool', toolName: forcedTool } } : {},
    // See src/app/api/chat/route.ts for why this is required — without
    // it, a tool call's result never gets fed back for a follow-up
    // response, so e.g. "list the contractors" calls list_contractors
    // and then the reply just stops with no answer.
    stopWhen: stepCountIs(5),
    system:
      'You are a caseworker assistant for the SmartGov admin console. ' +
      'You can list contractors, disable one contractor at a time, or bulk-disable ' +
      'several at once. ' +
      // See src/app/api/chat/route.ts for why this matters - RBAC, FGA
      // grants, and step-up approval can all change between messages,
      // and the model has no way to know their current state except by
      // calling a tool again.
      'Step-up approval, and FGA grants on specific contractors, can change between messages, ' +
      'and you have no way to know their current state except by calling a tool - never answer ' +
      'a request from what a PREVIOUS tool call in this conversation returned. Always call the ' +
      'tool again, every single time, even if an identical request was just denied a moment ago. ' +
      'A tool result may contain an "error" field for two distinct reasons - ' +
      'treat them differently: if bulk_disable_contractors reports denied ids, or an error ' +
      'explicitly mentions step-up or authorization, tell the caseworker plainly that step-up ' +
      'is missing or expired, not that something is broken. If the error instead says ' +
      'something like "could not reach the MCP server" or "MCP tool call failed", that is a ' +
      'real system/connectivity problem, not a permissions issue - tell the caseworker plainly ' +
      'that something went wrong reaching the admin tools and they should try again, and do ' +
      'NOT guess or invent a reason involving step-up or permissions when the error itself did ' +
      'not say that. For a system/connectivity error specifically, quote the exact error text ' +
      'verbatim in your response (in a code block) rather than paraphrasing it - this app is ' +
      'still being tested and the exact error text is what a developer needs to see. ' +
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
