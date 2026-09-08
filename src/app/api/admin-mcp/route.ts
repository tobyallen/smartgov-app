import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { verifyMcpAccessToken } from '@/lib/mcpAuth';
import { listContractors, disableContractor, bulkDisableContractors } from '@/lib/adminTools';
import type { TraceEvent } from '@/lib/tools';

// RBAC happens here, at registration time, not at call time: a citizen
// caller never sees disable_contractor/bulk_disable_contractors in
// list_tools at all, because they're never registered on their server
// instance. FGA is layered underneath regardless — every handler still
// re-checks its own authorization on every call, so RBAC narrows what's
// offered, it never substitutes for the FGA check.
function buildServer(caseworkerUserId: string) {
  const server = new McpServer({ name: 'smartgov-admin-mcp', version: '1.0.0' });

  // Persisted individually by checkAndLog/checkStepUpBulkDisable
  // regardless; collected here ADDITIONALLY so the admin-chat backend
  // (a real MCP client, calling over HTTP) can render trace cards from
  // the tool result payload - a callback can't cross the network hop.
  function withTrace<T>(fn: (trace: (e: TraceEvent) => void) => Promise<T>) {
    const traceEvents: TraceEvent[] = [];
    return fn((e) => traceEvents.push(e))
      .then((result) => ({
        content: [{ type: 'text' as const, text: JSON.stringify({ result, traceEvents }) }],
      }))
      // See src/app/api/mcp/route.ts's withTrace - same backstop, so a
      // tool handler throwing (rather than returning { error }) can't
      // turn into a bare error-message string in content[0].text that
      // breaks the chat routes' JSON.parse on the way back.
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
    'list_contractors',
    { description: 'List all contractors and their current status.' },
    async () => withTrace((trace) => listContractors({ caseworkerUserId, trace })),
  );

  server.registerTool(
    'disable_contractor',
    {
      description: 'Disable a single contractor by id.',
      inputSchema: { contractorId: z.string() },
    },
    async ({ contractorId }) =>
      withTrace((trace) => disableContractor({ caseworkerUserId, trace }, contractorId)),
  );

  server.registerTool(
    'bulk_disable_contractors',
    {
      description:
        'Disable multiple contractors at once. Requires a fresh step-up approval via /api/request-step-up.',
      inputSchema: { contractorIds: z.array(z.string()) },
    },
    async ({ contractorIds }) =>
      withTrace((trace) => bulkDisableContractors({ caseworkerUserId, trace }, contractorIds)),
  );

  return server;
}

export async function POST(request: NextRequest) {
  // Real Bearer/JWT auth against MCP_API_AUDIENCE, not the browser
  // session - see lib/mcpAuth.ts. The persona claim rides on the access
  // token itself (set by auth0-actions/assign-persona-role.js), so RBAC
  // here needs no separate lookup - it's checked from the same verified
  // token as the identity itself, not a second, potentially-stale source.
  const caller = await verifyMcpAccessToken(request);
  if (!caller) return new Response('Unauthorized', { status: 401 });
  if (caller.persona !== 'caseworker') {
    return new Response('Forbidden — caseworker role required', { status: 403 });
  }

  const server = buildServer(caller.userId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  return transport.handleRequest(request);
}
