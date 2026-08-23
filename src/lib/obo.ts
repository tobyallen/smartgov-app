import { logOboExchange } from './fga';

/**
 * RFC 8693 On-Behalf-Of token exchange — used for exactly one action
 * (submit_appeal → case-service API), per the reviewed/revised plan.
 * Not run on every tool call: OBO is showcased once, deliberately, not
 * threaded through the whole chat.
 */
export async function exchangeForCaseService({
  citizenUserId,
  citizenAccessToken,
}: {
  citizenUserId: string;
  citizenAccessToken: string;
}): Promise<string> {
  // Deliberately NOT the citizen portal's own client credentials: Auth0
  // requires the entity performing an OBO exchange to be its own
  // dedicated app_type=resource_server client with
  // token_exchange.allow_any_profile_of_type enabled — a separate
  // identity representing "the chatbot backend", distinct from both the
  // citizen-facing web app and the citizen themselves.
  const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.OBO_BACKEND_CLIENT_ID,
      client_secret: process.env.OBO_BACKEND_CLIENT_SECRET,
      subject_token: citizenAccessToken,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: process.env.CASE_SERVICE_AUDIENCE,
    }),
  });

  if (!response.ok) {
    throw new Error(`OBO token exchange failed: ${response.status} ${await response.text()}`);
  }

  const { access_token } = (await response.json()) as { access_token: string };

  // Logged separately from the FGA checks either side of it — this is
  // the event the "cross-service" trace card in chat renders from.
  await logOboExchange({
    citizenUserId,
    detail: {
      audience: process.env.CASE_SERVICE_AUDIENCE,
      note: 'sub preserved as citizen; act claim added identifying the agent that performed the exchange',
    },
  });

  return access_token;
}
