import { NextRequest } from 'next/server';
import { streamText, tool, stepCountIs, type UIMessage, convertToModelMessages } from 'ai';
import { z } from 'zod';
import { auth0 } from '@/lib/auth0';
import { chatModel } from '@/lib/ai';
import { checkCaseStatus, submitAppeal, type TraceEvent } from '@/lib/tools';

// The hot path every attendee uses: wires the SAME tool handlers as
// /api/mcp directly into the AI SDK's tool-calling, rather than having
// the chat backend loop back over HTTP to its own MCP endpoint. That
// self-hop would add latency and fan-out for no narrative benefit — the
// MCP requirement is satisfied by /api/mcp being a real, independently
// callable server, not by forcing every chat turn through it too.
export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const { token } = await auth0.getAccessToken();
  const citizenUserId = session.user.sub;

  const { messages }: { messages: UIMessage[] } = await request.json();

  const traceEvents: TraceEvent[] = [];
  const trace = (event: TraceEvent) => traceEvents.push(event);

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
        execute: async () => checkCaseStatus({ citizenUserId, citizenAccessToken: token, trace }),
      }),
      submit_appeal: tool({
        description: "Submit a formal appeal for the caller's own case.",
        inputSchema: z.object({}),
        execute: async () => submitAppeal({ citizenUserId, citizenAccessToken: token, trace }),
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
