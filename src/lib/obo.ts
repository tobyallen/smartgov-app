import { logOboExchange } from './fga';
import { firestore } from './firebase-admin';

/**
 * RFC 8693 On-Behalf-Of token exchange. Two call sites, two hops, and -
 * despite both being OBO - two DIFFERENT exchanging client identities,
 * not one shared one. Auth0 requires the client performing an exchange
 * to have resource_server_identifier equal to the subject token's own
 * `aud`, independent of the destination audience being requested (see
 * the "six checks later" post - this field can't be edited after
 * creation, and is checked against what's already inside the token you
 * hand in, not where it's headed). exchangeForMcp's subject token is
 * the citizen's original APP_API_AUDIENCE login token; exchangeForCaseService's
 * subject token is the ALREADY-EXCHANGED MCP_API_AUDIENCE token the MCP
 * tool handler is holding by the time submit_appeal runs - two different
 * `aud` values, so two different clients, each registered as the
 * resource server matching the token it's actually handed.
 */
async function exchangeToken({
  userId,
  accessToken,
  audience,
  clientId,
  clientSecret,
}: {
  userId: string;
  accessToken: string;
  audience: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
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
      note: 'sub preserved as the caller; act.sub now a real Auth0 agent identity (agent_subject_claims: auth0-v1), not just a generic client marker — see lib/mcpAuth.ts',
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

  const token = await exchangeToken({
    userId,
    accessToken,
    audience: process.env.MCP_API_AUDIENCE!,
    clientId: process.env.OBO_BACKEND_CLIENT_ID!,
    clientSecret: process.env.OBO_BACKEND_CLIENT_SECRET!,
  });
  await cacheRef.set({ token, cachedAt: new Date() });
  return { token, freshlyExchanged: true };
}

/**
 * The inner hop, used only inside submit_appeal's own handler: MCP tool
 * handler -> downstream case service. Distinct from exchangeForMcp above -
 * this one happens a layer deeper, once a tool call has already reached
 * the MCP server, not on every tool call. Its subject token is the
 * MCP_API_AUDIENCE token the tool handler is already holding, not the
 * citizen's original login token - a different `aud`, so a different
 * exchanging client identity (OBO_CASE_SERVICE_CLIENT_ID), registered
 * with resource_server_identifier = MCP_API_AUDIENCE to match it. Using
 * OBO_BACKEND_CLIENT_ID here (registered for APP_API_AUDIENCE instead)
 * fails with "This client cannot exchange access tokens for this
 * audience" even though every client-grant and resource-server setting
 * checks out - confirmed live, see the "six checks later" post.
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
    clientId: process.env.OBO_CASE_SERVICE_CLIENT_ID!,
    clientSecret: process.env.OBO_CASE_SERVICE_CLIENT_SECRET!,
  });
}
