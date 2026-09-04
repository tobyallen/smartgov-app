import { logOboExchange } from './fga';
import { firestore } from './firebase-admin';

/**
 * RFC 8693 On-Behalf-Of token exchange. Two call sites, two hops, both
 * real: exchangeForMcp (chat backend -> MCP server) and
 * exchangeForCaseService (MCP tool handler -> downstream case service).
 * Both share this one implementation, parameterized by target audience -
 * same grant, same exchanging identity, different destination.
 */
async function exchangeToken({
  userId,
  accessToken,
  audience,
}: {
  userId: string;
  accessToken: string;
  audience: string;
}): Promise<string> {
  // Deliberately NOT the citizen portal's own client credentials: Auth0
  // requires the entity performing an OBO exchange to be its own
  // dedicated app_type=resource_server client with
  // token_exchange.allow_any_profile_of_type enabled — a separate
  // identity representing "the chatbot backend", distinct from both the
  // citizen-facing web app and the citizen/caseworker themselves.
  const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.OBO_BACKEND_CLIENT_ID,
      client_secret: process.env.OBO_BACKEND_CLIENT_SECRET,
      subject_token: accessToken,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience,
    }),
  });

  if (!response.ok) {
    throw new Error(`OBO token exchange failed: ${response.status} ${await response.text()}`);
  }

  const { access_token } = (await response.json()) as { access_token: string };

  // Logged separately from the FGA checks either side of it — this is
  // the event the "cross-service" trace card renders from. detail.audience
  // is what lets two exchanges in the same turn (chat->MCP, then
  // MCP-tool->case-service for submit_appeal) read as distinct events
  // rather than a confusing duplicate pair.
  await logOboExchange({
    onBehalfOf: userId,
    detail: {
      audience,
      note: 'sub preserved as the caller; act claim added identifying the agent that performed the exchange',
    },
  });

  return access_token;
}

function decodeJwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * The outer hop: chat backend -> this app's own MCP server
 * (/api/mcp or /api/admin-mcp), used for every tool call now that the
 * chat routes are real MCP clients rather than calling tool handlers
 * in-process. See src/lib/mcpClient.ts for where this gets used.
 *
 * Cached in Firestore, not re-exchanged on every call: the MCP_API_AUDIENCE
 * token has its own real validity window (900s on the tenant, matching
 * delegation_window) - minting a fresh one on every single chat message
 * is pure network overhead against Auth0's /oauth/token endpoint for no
 * security benefit, since the token itself doesn't expire that fast.
 * This is deliberately separate from the FGA delegation check inside
 * check_case_status/submit_appeal, which still runs fresh on every call -
 * a cached MCP token only proves "this backend was recently allowed to
 * reach the MCP server," never "the citizen currently has delegation,"
 * which is a different, faster-changing fact this token was never meant
 * to encode.
 */
export async function exchangeForMcp({
  userId,
  accessToken,
}: {
  userId: string;
  accessToken: string;
}): Promise<{ token: string; freshlyExchanged: boolean }> {
  const cacheRef = firestore().collection('mcpTokenCache').doc(userId);
  const cached = await cacheRef.get();
  const cachedToken = cached.data()?.token as string | undefined;

  // 30s leeway so a token that's about to expire mid-request doesn't get
  // handed to the MCP server only to be rejected there a moment later.
  if (cachedToken) {
    const exp = decodeJwtExpiry(cachedToken);
    if (exp && exp * 1000 > Date.now() + 30_000) {
      return { token: cachedToken, freshlyExchanged: false };
    }
  }

  const token = await exchangeToken({ userId, accessToken, audience: process.env.MCP_API_AUDIENCE! });
  await cacheRef.set({ token, cachedAt: new Date() });
  return { token, freshlyExchanged: true };
}

/**
 * The inner hop, used only inside submit_appeal's own handler: MCP tool
 * handler -> downstream case service. Distinct from exchangeForMcp above -
 * this one happens a layer deeper, once a tool call has already reached
 * the MCP server, not on every tool call.
 */
export async function exchangeForCaseService({
  citizenUserId,
  citizenAccessToken,
}: {
  citizenUserId: string;
  citizenAccessToken: string;
}): Promise<string> {
  return exchangeToken({
    userId: citizenUserId,
    accessToken: citizenAccessToken,
    audience: process.env.CASE_SERVICE_AUDIENCE!,
  });
}
