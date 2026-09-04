import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  secret: process.env.AUTH0_SECRET!,
  appBaseUrl: process.env.APP_BASE_URL!,
  // Was previously unset, meaning the SDK's own defaults applied
  // silently: rolling, 1-day inactivity, 3-day absolute cap - explaining
  // a real symptom (a session reloaded the next day with no activity in
  // between got a bare 401 on the next chat message, since the session
  // cookie itself had already expired, independent of anything on the
  // Auth0 tenant - the refresh token there is non-expiring). Explicit
  // now so a stale session expires close to a single workshop sitting,
  // not silently on whatever the SDK happens to default to today.
  session: {
    inactivityDuration: 60 * 60, // 1 hour
    absoluteDuration: 60 * 60, // no rolling benefit beyond the inactivity window for this app
  },
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
