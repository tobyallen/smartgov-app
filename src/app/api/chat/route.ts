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
  const citizenUserId = session.user.sub;

  // getAccessToken() throws when the refresh token is expired/invalid
  // (e.g. a session that's outlived its Auth0 refresh token) - left
  // unhandled, this crashed the whole request into a bare 500 with no
  // explanation, the same failure shape as the MCP connect/exchange
  // errors caught below, just one step earlier. A stale session should
  // read as "please log in again," not silence.
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

  // One exchange, one connection, reused for every tool call this turn -
  // not re-exchanged per call. The exchange itself is the OBO event this
  // turn demonstrates; connecting once and calling multiple tools on the
  // same connection doesn't need a fresh token per call.
  //
  // Deliberately NOT allowed to throw an unhandled rejection here: this
  // used to be able to crash the whole request into a bare 500 with no
  // explanation at all if the exchange or connection failed for any
  // reason (misconfigured audience, expired subject token, MCP server
  // unreachable) - the model never got a turn, so it couldn't even say
  // "I can't access this," which is exactly the failure mode this file's
  // own system prompt tells the model never to produce. Every tool call
  // this turn now returns a structured error instead, the same shape
  // checkCaseStatus/submitAppeal already use for an FGA denial - the
  // model treats "couldn't reach the tool" and "reached the tool, denied"
  // as the same kind of thing to explain plainly, not two different
  // failure classes.
  let mcpClient: Awaited<ReturnType<typeof connectToMcpServer>>['client'] | null = null;
  let connectionError: string | null = null;
  try {
    const connection = await connectToMcpServer({ userId: citizenUserId, accessToken: token, mcpPath: '/api/mcp' });
    mcpClient = connection.client;
    // Only a real event on a fresh exchange - most turns reuse the
    // cached MCP_API_AUDIENCE token (see lib/obo.ts), so there's nothing
    // trace-worthy to show for those, and showing an identical "exchanging
    // token" card on every single message would misrepresent what
    // actually happened this turn.
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
      // Surface as much real detail as the error actually has - a
      // StreamableHTTPError carries the HTTP status code separately from
      // its message, and losing that distinction is exactly what made
      // this failure indistinguishable from an FGA denial to the model
      // reading only a generic "tool call failed" string.
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: unknown }).code : undefined;
      const message = err instanceof Error ? err.message : String(err);
      return { error: `MCP tool call failed${code ? ` (HTTP ${code})` : ''}: ${message}` };
    }
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
      'You can only act within whatever delegation the citizen has granted you. ' +
      'A tool result may contain an "error" field for two distinct reasons - treat them ' +
      'differently: if the error explicitly mentions delegation, an appeal window, or ' +
      "authorization being denied, say so plainly and explain it's a permissions issue, " +
      'not a system error. If the error instead says something like "could not reach the ' +
      'MCP server" or "MCP tool call failed", that is a real system/connectivity problem, ' +
      'not a permissions issue - tell the user plainly that something went wrong reaching ' +
      "the case system and they should try again, and do NOT guess or invent a reason " +
      'involving delegation or the appeal window when the error itself did not say that. ' +
      'For a system/connectivity error specifically, quote the exact error text verbatim ' +
      'in your response (in a code block) rather than paraphrasing it - this app is still ' +
      'being tested and the exact error text is what a developer needs to see. ' +
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
