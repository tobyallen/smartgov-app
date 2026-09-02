import { NextRequest } from 'next/server';
import { streamText, tool, stepCountIs, type UIMessage, convertToModelMessages } from 'ai';
import { z } from 'zod';
import { auth0 } from '@/lib/auth0';
import { chatModel } from '@/lib/ai';
import { connectToMcpServer } from '@/lib/mcpClient';
import type { TraceEvent } from '@/lib/tools';

// A real MCP client, not a caller of the same in-process handlers
// /api/mcp happens to also expose: every tool call here goes through an
// OBO exchange (the citizen's own access token -> a token scoped to
// MCP_API_AUDIENCE, see lib/mcpClient.ts / lib/obo.ts) and a genuine HTTP
// request to /api/mcp, Bearer-authenticated with the exchanged token and
// validated there exactly as any independent external MCP client's
// request would be. This reverses an earlier "no self-hop, same handlers
// either way" design - that reasoning held until OBO became a
// requirement for this specific hop, at which point there needed to be
// an actual second party to hop to for the exchange to mean anything.
export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { token } = await auth0.getAccessToken();
  const citizenUserId = session.user.sub;

  const { messages }: { messages: UIMessage[] } = await request.json();

  const traceEvents: TraceEvent[] = [];
  const trace = (event: TraceEvent) => traceEvents.push(event);

  // One exchange, one connection, reused for every tool call this turn -
  // not re-exchanged per call. The exchange itself is the OBO event this
  // turn demonstrates; connecting once and calling multiple tools on the
  // same connection doesn't need a fresh token per call.
  const mcpClient = await connectToMcpServer({ userId: citizenUserId, accessToken: token, mcpPath: '/api/mcp' });
  trace({ kind: 'obo_exchange', label: 'Exchanging token to reach the MCP server (MCP_API_AUDIENCE)' });

  async function callMcpTool(name: string, args: Record<string, unknown> = {}) {
    const response = await mcpClient.callTool({ name, arguments: args });
    const content = response.content as Array<{ type: string; text?: string }>;
    const raw = content[0]?.text ?? '{}';
    const { result, traceEvents: toolTraceEvents } = JSON.parse(raw) as {
      result: unknown;
      traceEvents: TraceEvent[];
    };
    for (const event of toolTraceEvents) trace(event);
    return result;
  }

  const result = streamText({
    model: chatModel(),
    // Without stopWhen, streamText stops after ONE step — if that step is
    // a tool call, the tool executes but its result never gets fed back
    // for a follow-up response, so the reply just... stops. stepCountIs(5)
    // lets the model call a tool, see the result, and answer in the same
    // turn - confirmed missing via a real admin-chat request that called
    // list_contractors, logged its own <thinking> about doing so, then
    // produced no answer at all.
    stopWhen: stepCountIs(5),
    system:
      "You are a citizen's own AI assistant for the SmartGov case portal. " +
      'You can only act within whatever delegation the citizen has granted you — ' +
      "if a tool call is denied, say so plainly and explain it's because delegation " +
      'is off or the appeal window has closed, not a system error. ' +
      // Nova Pro isn't a reasoning model with a separate thinking channel
      // the AI SDK could strip out — this is literal text output it was
      // trained to produce, so the only fix is telling it not to.
      'Do not include <thinking> tags or any other visible reasoning in your ' +
      'response — respond only with your final answer to the user.',
    messages: await convertToModelMessages(messages),
    tools: {
      check_case_status: tool({
        description: "Check the status of the caller's own case.",
        inputSchema: z.object({}),
        execute: async () => callMcpTool('check_case_status'),
      }),
      submit_appeal: tool({
        description: "Submit a formal appeal for the caller's own case.",
        inputSchema: z.object({}),
        execute: async () => callMcpTool('submit_appeal'),
      }),
    },
    onFinish: async () => {
      // traceEvents collected during this turn are also each individually
      // persisted by checkAndLog/logOboExchange as they happen — this
      // array is only for rendering trace cards inline in THIS response,
      // not a second logging path.
    },
  });

  return result.toUIMessageStreamResponse({
    messageMetadata: () => ({ traceEvents }),
  });
}
