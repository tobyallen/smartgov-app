/**
 * Friendly display names for the client IDs and Agent-as-Principal
 * external_agent_ids that appear as `sub`/`act.sub` values in this app's
 * tokens. Single source of truth, used by:
 * - TokenBlock.tsx (client component) - the hop-chain diagram and the
 *   annotated raw-claims JSON in every trace card / debug token viewer.
 * - lib/obo.ts (server) - so obo_exchange audit events can record which
 *   named service performed each hop, not just an opaque client ID.
 *
 * Extracted out of TokenBlock.tsx (2026-09-22) rather than imported
 * directly from it, since obo.ts is server-only and TokenBlock.tsx is
 * 'use client' - a plain constant export would likely work across that
 * boundary, but a dedicated shared module removes the ambiguity rather
 * than relying on it.
 *
 * Deliberately data-only, no process.env reads - see audienceNames.ts
 * for the server-only counterpart (audience URLs, which ARE sourced
 * from env vars per-tenant). Keeping the two separate means this file
 * stays safe to import from a 'use client' component with no risk of a
 * server-only env-var read accidentally shipping into a client bundle
 * (adversarial review, 2026-09-22 - flagged as a latent risk in the
 * original single-file version, not an active bug since nothing called
 * the audience function client-side, but not worth relying on
 * bundler/tree-shaking behaviour to keep it that way).
 *
 * Client IDs aren't secrets (only their secrets are), so hardcoding them
 * here is fine - this only exists to make a token's `act` chain (or an
 * audit event's `detail.fromService`) readable as "which app did this
 * hop" instead of a bare opaque ID. Falls back to the raw ID for
 * anything not in this tenant's known set, rather than hiding an
 * unrecognised hop.
 */
export const CLIENT_DISPLAY_NAMES: Record<string, string> = {
  zS9EnPkBdrI0QXfQ73XKMKr7oCnKRNj0: 'SmartGov Citizen Portal',
  xCMSFekvf2fsIFVFqPPz7RkkaE4UyFV0: 'Chatbot Backend',
  pk8ytDLT2CtIoxrFFQqKXaUrRdZs2q94: 'SmartGov Chatbot Backend (case-service hop)',
  // Auth0 Agent as Principal (EA) — act.sub shows the external_agent_id set
  // at registration, not a client ID, once agent_subject_claims: 'auth0-v1'
  // is enabled on the resource server (see mcpAuth.ts). A distinct name
  // space from the client-id map above, so both are checked by the same
  // lookup rather than needing the caller to know which kind of id it is.
  'smartgov-chatbot-backend': 'Agent: SmartGov Chatbot Backend',
  'smartgov-case-service-caller': 'Agent: SmartGov Case Service Caller',
};

/** Falls back to the raw id if it's not in the known set - see module comment above. */
export function serviceDisplayName(id: string): string {
  return CLIENT_DISPLAY_NAMES[id] ?? id;
}
