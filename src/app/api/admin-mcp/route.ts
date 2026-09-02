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

  const trace = (event: TraceEvent) => {
    void event; // persisted individually by checkAndLog/checkStepUpBulkDisable
  };

  server.registerTool(
    'list_contractors',
    { description: 'List all contractors and their current status.' },
    async () => {
      const result = await listContractors({ caseworkerUserId, trace });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'disable_contractor',
    {
      description: 'Disable a single contractor by id.',
      inputSchema: { contractorId: z.string() },
    },
    async ({ contractorId }) => {
      const result = await disableContractor({ caseworkerUserId, trace }, contractorId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'bulk_disable_contractors',
    {
      description:
        'Disable multiple contractors at once. Requires a fresh step-up approval via /api/request-step-up.',
      inputSchema: { contractorIds: z.array(z.string()) },
    },
    async ({ contractorIds }) => {
      const result = await bulkDisableContractors({ caseworkerUserId, trace }, contractorIds);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
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
