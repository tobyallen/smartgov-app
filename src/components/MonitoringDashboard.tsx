'use client';

import { useEffect, useState } from 'react';

type Severity = 'info' | 'warning' | 'critical';

type SnapshotEvent = { type: string; severity: Severity; summary: string; createdAt: string };
type SnapshotAlert = {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  status: 'active' | 'resolved';
  updatedAt: string;
};
type Snapshot = {
  counts: { signups: number; loginsSuccess: number; loginsFailed: number };
  activeAlerts: number;
  alerts: SnapshotAlert[];
  recentEvents: SnapshotEvent[];
};

const POLL_INTERVAL_MS = 10_000;

const SEVERITY_CLASSES: Record<Severity, string> = {
  info: 'text-ink-secondary',
  warning: 'text-amber-600',
  critical: 'text-status-critical',
};

/**
 * Polls /api/monitoring/snapshot on an interval rather than using
 * onSnapshot/websockets/SSE - consistent with the rest of this app,
 * which has no live server-pushed connection anywhere (see the build
 * plan's "MCP hosting resolved" note). 10s is fast enough to read as
 * "live" for a human watching a screen during a talk, without adding a
 * connection type this app has zero other precedent for.
 */
export function MonitoringDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/monitoring/snapshot');
        if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
        const data = (await res.json()) as Snapshot;
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) {
    return <p className="mt-6 text-sm text-status-critical">Couldn&apos;t load monitoring data: {error}</p>;
  }
  if (!snapshot) {
    return <p className="mt-6 text-sm text-ink-muted">Loading…</p>;
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="Signups (15 min)" value={snapshot.counts.signups} />
        <Counter label="Logins ok (15 min)" value={snapshot.counts.loginsSuccess} />
        <Counter label="Logins failed (15 min)" value={snapshot.counts.loginsFailed} tone={snapshot.counts.loginsFailed > 0 ? 'warning' : undefined} />
        <Counter label="Active alerts" value={snapshot.activeAlerts} tone={snapshot.activeAlerts > 0 ? 'critical' : undefined} />
      </div>

      <section>
        <h2 className="text-sm font-semibold text-ink-primary">Alerts</h2>
        {snapshot.alerts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No alerts recorded yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {snapshot.alerts.map((alert) => (
              <li key={alert.ruleId} className="rounded border border-ink-muted/20 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${SEVERITY_CLASSES[alert.severity]}`}>{alert.title}</span>
                  <span className="text-xs uppercase text-ink-muted">{alert.status}</span>
                </div>
                <p className="mt-1 text-ink-secondary">{alert.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink-primary">Recent events</h2>
        {snapshot.recentEvents.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No events recorded yet.</p>
        ) : (
          <ul className="mt-2 max-h-96 space-y-1 overflow-y-auto text-sm">
            {snapshot.recentEvents.map((event, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className={SEVERITY_CLASSES[event.severity]}>{event.summary}</span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {new Date(event.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
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
