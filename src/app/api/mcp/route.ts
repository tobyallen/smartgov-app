import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { auth0 } from '@/lib/auth0';
import { checkCaseStatus, submitAppeal, type TraceEvent } from '@/lib/tools';

// A real, standards-compliant MCP server (Streamable HTTP over Web
// Standard Request/Response — the current spec transport, not the
// deprecated HTTP+SSE one) wrapping the same tool handlers the in-app
// chat uses. Any MCP client can point at this endpoint; it isn't
// presenter-only or chat-only.
function buildServer(citizenUserId: string, citizenAccessToken: string) {
  const server = new McpServer({ name: 'smartgov-case-mcp', version: '1.0.0' });

  const trace = (event: TraceEvent) => {
    // MCP-client callers don't get the chat trace-card UI, but every
    // check still lands in the shared audit_events table regardless of
    // which surface called the tool.
    void event;
  };

  server.registerTool(
    'check_case_status',
    { description: "Check the status of the caller's own case." },
    async () => {
      const result = await checkCaseStatus({ citizenUserId, citizenAccessToken, trace });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'submit_appeal',
    { description: "Submit a formal appeal for the caller's own case." },
    async () => {
      const result = await submitAppeal({ citizenUserId, citizenAccessToken, trace });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  return server;
}

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { token } = await auth0.getAccessToken();
  const server = buildServer(session.user.sub, token);
  // Stateless mode: no session ID, matching the "short request/response
  // tool calls" concurrency model — no persistent connection to manage
  // across 100 attendees.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  return transport.handleRequest(request);
}
