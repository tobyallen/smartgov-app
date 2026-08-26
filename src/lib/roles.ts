import type { User } from '@auth0/nextjs-auth0/types';

export type Persona = 'citizen' | 'caseworker';

const PERSONA_CLAIM = 'https://smartgov.apidays/persona';

/**
 * The persona claim is set by auth0-actions/assign-persona-role.js via
 * api.idToken.setCustomClaim() - it's not in the SDK's own User type,
 * since that's a fixed interface with no room for custom namespaces.
 */
export function personaFor(user: User): Persona {
  const claim = (user as Record<string, unknown>)[PERSONA_CLAIM];
  return claim === 'caseworker' ? 'caseworker' : 'citizen';
}

export function isCaseworker(user: User): boolean {
  return personaFor(user) === 'caseworker';
}
