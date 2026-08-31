import type { SessionData } from '@auth0/nextjs-auth0/types';

export type Persona = 'citizen' | 'caseworker';

const PERSONA_CLAIM = 'https://smartgov.apidays/persona';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * The persona claim is set by auth0-actions/assign-persona-role.js via
 * api.idToken.setCustomClaim() on every login - but session.user is NOT
 * a reliable place to read it back from. The nextjs-auth0 SDK overwrites
 * session.user with a fresh, narrower claim set whenever ANY
 * auth0.getAccessToken() call anywhere in the app triggers a silent
 * token refresh (confirmed in the SDK's _AuthClient_updateSessionAfterTokenRetrieval:
 * `session.user = tokenSetResponse.idTokenClaims` on every refresh, no
 * merge with the prior value) - and Auth0's refresh-token grant doesn't
 * necessarily re-run post-login Actions the same way an interactive login
 * does, so a refreshed ID token can come back without the custom claim
 * even though the ORIGINAL login's ID token had it. Confirmed live: a
 * caseworker's own /api/debug-tokens response showed the raw idToken JWT
 * correctly containing the persona claim while session.user, in the same
 * response, did not.
 *
 * Fix: decode the current session's raw ID token directly, every time,
 * rather than trusting whatever session.user happens to hold.
 */
export function personaFor(session: SessionData): Persona {
  const idToken = session.tokenSet.idToken;
  const claims = idToken ? decodeJwtPayload(idToken) : null;
  const claim = claims?.[PERSONA_CLAIM];
  return claim === 'caseworker' ? 'caseworker' : 'citizen';
}

export function isCaseworker(session: SessionData): boolean {
  return personaFor(session) === 'caseworker';
}
