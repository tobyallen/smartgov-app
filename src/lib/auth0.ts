import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  secret: process.env.AUTH0_SECRET!,
  appBaseUrl: process.env.APP_BASE_URL!,
  // Without an explicit audience, Auth0 issues an opaque access token,
  // not a JWT - confirmed live: the OBO token-exchange grant rejected
  // that opaque token with "Not supported JWT type in subject token,"
  // which had been silently blocking BOTH submit_appeal's exchange (to
  // case-service) and the newer chat-backend-to-MCP exchange the whole
  // time, since neither had ever actually been exercised with a real
  // logged-in user's token before now. auth0.getAccessToken() needs a
  // real signed JWT scoped to a registered custom API to be usable as
  // an RFC 8693 subject_token at all.
  authorizationParameters: {
    audience: process.env.APP_API_AUDIENCE,
  },
});
