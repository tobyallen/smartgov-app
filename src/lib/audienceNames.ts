/**
 * Server-only: friendly display names for resource-server audience
 * URLs, resolved from this deployment's own env vars. Deliberately
 * separate from serviceNames.ts (client IDs, safe to import from a
 * 'use client' component) - an OBO exchange's DESTINATION is always an
 * audience, never a client, so it needs its own lookup rather than
 * being forced through CLIENT_DISPLAY_NAMES, and audiences are resolved
 * from process.env, which has no business being reachable from a
 * client bundle at all (see serviceNames.ts's own comment on why the
 * two were split apart, 2026-09-22 adversarial review).
 *
 * Only import this from server code (lib/obo.ts today). If a client
 * component ever needs an audience label, it should come from a server
 * response, not a direct import of this module.
 */
const AUDIENCE_DISPLAY_NAMES = new Map<string, string>();
// Built once at module load, skipping any env var that's unset -
// without the skip, two+ unset vars would all resolve to the same ''
// key and the map would silently answer a lookup for an empty/missing
// audience with whichever env var happened to be assigned last (a real
// bug in an earlier version of this file, caught by adversarial review
// before it shipped - confirmed via a plain object literal with
// repeated '' keys: only the last survives).
if (process.env.MCP_API_AUDIENCE) AUDIENCE_DISPLAY_NAMES.set(process.env.MCP_API_AUDIENCE, 'SmartGov MCP Server');
if (process.env.CASE_SERVICE_AUDIENCE) AUDIENCE_DISPLAY_NAMES.set(process.env.CASE_SERVICE_AUDIENCE, 'Case Service');
if (process.env.APP_API_AUDIENCE) AUDIENCE_DISPLAY_NAMES.set(process.env.APP_API_AUDIENCE, 'SmartGov App API');

/** Falls back to the raw audience string if it's not one of this deployment's own known audiences. */
export function audienceDisplayName(audience: string): string {
  return AUDIENCE_DISPLAY_NAMES.get(audience) ?? audience;
}
