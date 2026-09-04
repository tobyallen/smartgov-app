import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { exchangeForMcp } from './obo';

/**
 * The chat routes (/api/chat, /api/admin-chat) are real MCP clients, not
 * just callers of the same in-process handlers /api/mcp and
 * /api/admin-mcp happen to also expose. Every tool call now goes:
 * caller's own access token -> OBO exchange for MCP_API_AUDIENCE
 * (exchangeForMcp) -> a genuine HTTP request to this deployment's own
 * /api/mcp or /api/admin-mcp, Bearer-authenticated with the exchanged
 * token, validated there by lib/mcpAuth.ts exactly as any independent
 * external MCP client's request would be. Same deployment, but a real
 * network hop through Vercel's routing, not a function call - this is
 * what makes the OBO exchange meaningful rather than decorative.
 */
export async function connectToMcpServer({
  userId,
  accessToken,
  mcpPath,
}: {
  userId: string;
  accessToken: string;
  mcpPath: '/api/mcp' | '/api/admin-mcp';
}): Promise<{ client: Client; exchangedToken: string; freshlyExchanged: boolean }> {
  const { token: exchangedToken, freshlyExchanged } = await exchangeForMcp({ userId, accessToken });

  const transport = new StreamableHTTPClientTransport(
    new URL(mcpPath, process.env.APP_BASE_URL!),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${exchangedToken}` },
      },
    },
  );

  const client = new Client({ name: 'smartgov-chat-backend', version: '1.0.0' });
  await client.connect(transport);
  // Returned alongside the client, not just used internally, so the
  // caller's own trace() call can attach it to the obo_exchange event,
  // and only log that event when a real exchange happened this call -
  // exchangeForMcp caches the token (see lib/obo.ts), so most turns
  // within the token's validity window reuse it silently.
  return { client, exchangedToken, freshlyExchanged };
}
