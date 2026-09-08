import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { verifyMcpAccessToken } from '@/lib/mcpAuth';
import { checkCaseStatus, submitAppeal, type TraceEvent } from '@/lib/tools';

// A real, standards-compliant MCP server (Streamable HTTP over Web
// Standard Request/Response — the current spec transport, not the
// deprecated HTTP+SSE one) wrapping the same tool handlers the in-app
// chat uses. Any MCP client can point at this endpoint; it isn't
// presenter-only or chat-only.
function buildServer(citizenUserId: string, citizenAccessToken: string) {
  const server = new McpServer({ name: 'smartgov-case-mcp', version: '1.0.0' });

  // Every check still lands in the shared auditEvents table regardless of
  // caller (that's unconditional, inside checkAndLog/logOboExchange
  // themselves). Collecting trace events per-call here is ADDITIONALLY
  // how the chat backend (now a real MCP client, calling over HTTP rather
  // than in-process) gets its trace-card UI back - riding along in the
  // tool result payload, since a callback can't cross the network hop.
  // An independent external MCP client gets the same payload and can
  // ignore this field if it doesn't care.
  function withTrace<T>(fn: (trace: (e: TraceEvent) => void) => Promise<T>) {
    const traceEvents: TraceEvent[] = [];
    return fn((e) => traceEvents.push(e))
      .then((result) => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ result, traceEvents }) }],
      }))
      // A tool handler throwing instead of returning { error } - e.g. an
      // OBO exchange's fetch() failing outright - must not become an
      // uncaught rejection here: the MCP SDK would turn that into a bare
      // error-message string in content[0].text, not the { result,
      // traceEvents } JSON shape callMcpTool in the chat routes expects,
      // so its JSON.parse throws its own unrelated-looking parse error
      // ("Unexpected token 'O', "OBO token "... is not valid JSON")
      // that hides what actually failed. Confirmed live: submit_appeal's
      // exchangeForCaseService call threw past this point before it was
      // wrapped in its own try/catch - this is the backstop for that
      // failure mode and any other tool that doesn't catch its own.
      .catch((err) => ({
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              result: { error: err instanceof Error ? err.message : String(err) },
              traceEvents,
            }),
          },
        ],
      }));
  }

  server.registerTool(
    'check_case_status',
    { description: "Check the status of the caller's own case." },
    async () =>
      withTrace((trace) => checkCaseStatus({ citizenUserId, citizenAccessToken, trace })),
  );

  server.registerTool(
    'submit_appeal',
    { description: "Submit a formal appeal for the caller's own case." },
    async () =>
      withTrace((trace) => submitAppeal({ citizenUserId, citizenAccessToken, trace })),
  );

  return server;
}

export async function POST(request: NextRequest) {
  // Real Bearer/JWT auth against this server's own MCP_API_AUDIENCE, not
  // the browser session cookie - any independent MCP client can call
  // this route with a token it obtained itself, the same way it would
  // call any other Auth0-protected API. See lib/mcpAuth.ts for why this
  // isn't OBO.
  const caller = await verifyMcpAccessToken(request);
  if (!caller) return new Response('Unauthorized', { status: 401 });

  const authHeader = request.headers.get('authorization')!;
  const token = authHeader.slice('Bearer '.length);
  const server = buildServer(caller.userId, token);
  // Stateless mode: no session ID, matching the "short request/response
  // tool calls" concurrency model — no persistent connection to manage
  // across 100 attendees.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  return transport.handleRequest(request);
}
