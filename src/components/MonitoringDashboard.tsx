'use client';

import { useCallback, useEffect, useState } from 'react';

type Severity = 'info' | 'warning' | 'critical';

type SnapshotEvent = { type: string; severity: Severity; summary: string; createdAt: string };
type SnapshotAlert = { ruleId: string; severity: Severity; title: string; detail: string; breaching: boolean };
type Snapshot = {
  counts: { signups: number; loginsSuccess: number; loginsFailed: number };
  activeAlerts: number;
  alerts: SnapshotAlert[];
  recentEvents: SnapshotEvent[];
  fetchedAt: string;
};

const SEVERITY_CLASSES: Record<Severity, string> = {
  info: 'text-ink-secondary',
  warning: 'text-amber-600',
  critical: 'text-status-critical',
};

/**
 * Fetches /api/monitoring/snapshot on mount and on manual "Refresh"
 * click only - no auto-poll, no timer, no caching layer of any kind.
 * See monitoring-redesign-v6.md: every prior version's auto-poll or
 * caching mechanism was found, on adversarial review, to rely on an
 * unverified assumption about how many browser tabs/instances/operators
 * would be involved at once. A human clicking a button can only ever
 * issue one request at a time, which removes that entire category of
 * risk rather than trying to bound it - see the plan for the accepted
 * tradeoffs this gives up (no live auto-refresh, a spike between two
 * clicks may not be caught).
 */
export function MonitoringDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const refresh = useCallback(async () => {
    setIsFetching(true);
    try {
      const res = await fetch('/api/monitoring/snapshot');
      if (!res.ok) {
        // The route returns a real JSON error body on both its own
        // auth check (403) and an upstream Auth0 failure (502 - see
        // snapshot/route.ts) - surface that message rather than just
        // the bare status code, so "Auth0 is rate-limited/down" reads
        // differently from "you're not signed in as a dev-tools account."
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `snapshot fetch failed: ${res.status}`);
      }
      const data = (await res.json()) as Snapshot;
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    // void + microtask hop rather than calling refresh() directly - its
    // first statement is setIsFetching(true), and calling that
    // synchronously from inside the effect body trips
    // react-hooks/set-state-in-effect (a cascading-render risk lint,
    // already hit once before in this codebase - see CibaApproval.tsx).
    void Promise.resolve().then(refresh);
  }, [refresh]);

  return (
    <div className="mt-6 space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={refresh}
          disabled={isFetching}
          className="rounded border border-brand-primary px-3 py-1.5 text-sm font-medium text-brand-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
        {snapshot && (
          <span className="text-xs text-ink-muted">
            Last updated {new Date(snapshot.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-status-critical">Couldn&apos;t load monitoring data: {error}</p>}

      {!snapshot && !error && <p className="text-sm text-ink-muted">Loading…</p>}

      {snapshot && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Counter label="Signups (this fetch)" value={snapshot.counts.signups} />
            <Counter label="Logins ok (this fetch)" value={snapshot.counts.loginsSuccess} />
            <Counter
              label="Logins failed (this fetch)"
              value={snapshot.counts.loginsFailed}
              tone={snapshot.counts.loginsFailed > 0 ? 'warning' : undefined}
            />
            <Counter
              label="Active alerts"
              value={snapshot.activeAlerts}
              tone={snapshot.activeAlerts > 0 ? 'critical' : undefined}
            />
          </div>

          <section>
            <h2 className="text-sm font-semibold text-ink-primary">Alerts</h2>
            <ul className="mt-2 space-y-2">
              {snapshot.alerts.map((alert) => (
                <li key={alert.ruleId} className="rounded border border-ink-muted/20 p-3 text-sm">
                  <span className={`font-medium ${SEVERITY_CLASSES[alert.severity]}`}>{alert.title}</span>
                  <p className="mt-1 text-ink-secondary">{alert.detail}</p>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-ink-primary">Recent events</h2>
            {snapshot.recentEvents.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No events in this fetch.</p>
            ) : (
              <ul className="mt-2 max-h-96 space-y-1 overflow-y-auto text-sm">
                {snapshot.recentEvents.map((event, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span className={SEVERITY_CLASSES[event.severity]}>{event.summary}</span>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {new Date(event.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'critical' }) {
  const toneClass = tone === 'critical' ? 'text-status-critical' : tone === 'warning' ? 'text-amber-600' : 'text-ink-primary';
  return (
    <div className="rounded border border-ink-muted/20 p-3">
      <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
    </div>
  );
}
