import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { hasDevToolsRole } from '@/lib/roles';
import { fetchAuth0LogsSince } from '@/lib/monitoring/auth0Logs';
import { evaluateAuth0Alerts } from '@/lib/monitoring/alerts';

/**
 * GET /api/monitoring/snapshot — fetched on manual "Refresh" click only
 * (see MonitoringDashboard.tsx), never polled automatically. No
 * Firestore access at all - this route's entire data source is a
 * single Auth0 Management API call per click. See
 * monitoring-redesign-v6.md for why: every version of this feature
 * that touched Firestore (via auditEvents or a persisted event/alert
 * store) accumulated real correctness or quota problems across five
 * review rounds; dropping Firestore from this route removes every one
 * of those problems rather than solving them individually.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session || !hasDevToolsRole(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { events } = await fetchAuth0LogsSince(null);
  const alerts = evaluateAuth0Alerts(events);

  const counts = {
    signups: events.filter((e) => e.type === 'ss').length,
    loginsSuccess: events.filter((e) => e.type === 's').length,
    loginsFailed: events.filter((e) => ['f', 'fu', 'fp'].includes(e.type)).length,
  };

  return NextResponse.json({
    counts,
    activeAlerts: alerts.filter((a) => a.breaching).length,
    alerts,
    recentEvents: events
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map((e) => ({ type: e.type, severity: e.severity, summary: e.summary, createdAt: e.createdAt.toISOString() })),
    fetchedAt: new Date().toISOString(),
  });
}
