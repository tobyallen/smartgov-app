import type { MonitoringEventRecord, MonitoringSeverity } from './types';

// Deliberately its own client-credentials fetch, not shared with
// auth0-actions/assign-persona-role.js's ManagementClient (scoped to
// update:users only, and constructed inside an Auth0 Action - not
// reachable from this app's runtime at all) or with scripts/lib/auth0Cli.ts
// (which shells out to the `auth0` CLI specifically to avoid raw
// Management API calls from scripts - see that file's own header
// comment). Monitoring needs read:logs on a schedule from a Vercel
// Function, which neither existing pattern provides - see
// MONITORING_M2M_CLIENT_ID/SECRET in ENV_TEMPLATE.md.
let _cachedToken: { token: string; expiresAt: number } | undefined;

async function getManagementToken(): Promise<string> {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 30_000) {
    return _cachedToken.token;
  }
  const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.MONITORING_M2M_CLIENT_ID,
      client_secret: process.env.MONITORING_M2M_CLIENT_SECRET,
      audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) {
    // Same status-aware framing as the /logs fetch below - the token
    // endpoint is a separate Auth0 call and can independently 429/5xx,
    // though hit far less often given the token is cached for its full
    // lifetime rather than re-fetched on every click.
    const kind = response.status === 429 ? 'rate limited' : response.status >= 500 ? 'Auth0-side error' : 'error';
    throw new Error(
      `Auth0 token endpoint ${kind} (monitoring M2M client): ${response.status} ${await response.text()}`,
    );
  }
  const { access_token, expires_in } = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  _cachedToken = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

// Maps Auth0 tenant log event `type` codes to this app's normalized
// shape. Reference: https://auth0.com/docs/deploy-monitor/logs/log-event-type-codes
// Only codes this app's alert rules (alerts.ts) actually consume are
// mapped to non-'info' severities - everything else still gets recorded
// (for the raw event list) but won't trigger anything.
const EVENT_MAP: Record<string, { severity: MonitoringSeverity; summary: (log: Record<string, unknown>) => string }> = {
  s: { severity: 'info', summary: (l) => `Successful login: ${l.user_name ?? l.user_id ?? 'unknown user'}` },
  ss: { severity: 'info', summary: (l) => `Successful signup: ${l.user_name ?? l.user_id ?? 'unknown user'}` },
  f: { severity: 'warning', summary: (l) => `Failed login: ${l.user_name ?? 'unknown user'} — ${l.description ?? ''}`.trim() },
  fu: { severity: 'warning', summary: (l) => `Failed login (invalid username/email): ${l.user_name ?? 'unknown'}` },
  fp: { severity: 'warning', summary: (l) => `Failed login (wrong password): ${l.user_name ?? 'unknown'}` },
  limit_wc: { severity: 'critical', summary: () => 'Attack Protection: blocked brute-force login attempt' },
  limit_mu: { severity: 'critical', summary: () => 'Attack Protection: blocked excessive login attempts on one account' },
  sepft: { severity: 'critical', summary: () => 'Attack Protection: suspicious login flagged/blocked' },
  fce: { severity: 'critical', summary: (l) => `Auth0 Action failed: ${l.description ?? 'no description'}` },
};

type Auth0LogEntry = {
  log_id: string;
  _id?: string;
  date: string;
  type: string;
  [key: string]: unknown;
};

/**
 * Fetches Auth0 tenant logs since the given checkpoint (last-processed
 * log id, from monitoringCheckpoints/auth0 — see route.ts). Returns only
 * entries whose `type` this app maps (EVENT_MAP above); unmapped log
 * types are real Auth0 events but not ones this dashboard cares about,
 * so they're dropped here rather than stored as noise.
 *
 * Uses Auth0's checkpoint pagination (`from` = last log id, ascending
 * date sort) rather than a time-window query, so a slow poll or a
 * restart can't silently skip entries the way a `from`/`to` timestamp
 * query could if it ran late.
 */
export async function fetchAuth0LogsSince(
  lastLogId: string | null,
): Promise<{ events: MonitoringEventRecord[]; newestLogId: string | null }> {
  const token = await getManagementToken();
  const params = new URLSearchParams({ sort: 'date:1', take: '100' });
  if (lastLogId) params.set('from', lastLogId);

  const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/api/v2/logs?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    // Every Management API response (success or error) carries
    // x-ratelimit-limit/-remaining/-reset headers - confirmed live
    // against this tenant. A 429 specifically means this M2M client hit
    // its rate limit (15,000 req/~60s window at last check, so
    // extremely unlikely at this feature's manual-click volume, but
    // surfaced distinctly rather than folded into a generic message,
    // since "Auth0 is rate-limiting us" and "Auth0 is having an outage"
    // (a 5xx) call for different responses from whoever's watching this
    // dashboard). Not asserting a specific error-body shape here - Auth0
    // doesn't publish one precisely, and this app hasn't triggered a
    // real 429/5xx against this tenant to confirm one; response.text()
    // is included raw rather than parsed so nothing is lost either way.
    const resetHeader = response.headers.get('x-ratelimit-reset');
    const resetNote = resetHeader ? ` (resets at ${new Date(Number(resetHeader) * 1000).toISOString()})` : '';
    const kind = response.status === 429 ? 'rate limited' : response.status >= 500 ? 'Auth0-side error' : 'error';
    throw new Error(
      `Auth0 /api/v2/logs ${kind}: ${response.status}${resetNote} ${await response.text()}`,
    );
  }
  const logs = (await response.json()) as Auth0LogEntry[];
  if (logs.length === 0) {
    return { events: [], newestLogId: lastLogId };
  }

  const events: MonitoringEventRecord[] = [];
  for (const log of logs) {
    const mapping = EVENT_MAP[log.type];
    if (!mapping) continue;
    events.push({
      source: 'auth0',
      type: log.type,
      severity: mapping.severity,
      summary: mapping.summary(log),
      raw: log,
      createdAt: new Date(log.date),
    });
  }

  return { events, newestLogId: logs[logs.length - 1].log_id };
}

/** Doc-ID-safe key for a raw Auth0 log entry — used so re-processing a batch overwrites rather than duplicates. */
export function eventDocId(event: MonitoringEventRecord): string {
  const rawId = (event.raw as Auth0LogEntry).log_id;
  return `auth0-${rawId}`;
}
