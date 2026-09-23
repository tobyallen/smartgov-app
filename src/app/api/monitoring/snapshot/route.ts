import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { hasDevToolsRole } from '@/lib/roles';
import { firestore } from '@/lib/firebase-admin';

const COUNTS_WINDOW_MS = 15 * 60 * 1000; // last 15 minutes, for the counters row

// TEMPORARY, added 2026-09-24: the original 10s client poll x 60s cron
// poll cadence exhausted this project's Firestore free-tier daily read
// quota within hours of going live, which then broke /access-log too
// (a real citizen-facing route, completely unrelated to monitoring,
// sharing the same Firestore project/quota). The cron is disabled
// (vercel.json) and this route now fails fast with a clear response
// instead of attempting a Firestore read that would just throw
// RESOURCE_EXHAUSTED anyway - remove this flag once the polling design
// is fixed (batched reads, longer interval, and/or a paid Firestore
// tier) and re-enabling has actually been decided, not just assumed safe.
const MONITORING_DISABLED = true;

/**
 * GET /api/monitoring/snapshot — read-only, polled by MonitoringDashboard
 * every ~10s (client-side; see that component). Role-gated the same way
 * as every other read on this dashboard's data - dev-tools only, since
 * this is operator tooling, not something any citizen/caseworker should
 * reach even by guessing the URL.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session || !hasDevToolsRole(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  if (MONITORING_DISABLED) {
    return NextResponse.json(
      { error: 'Monitoring temporarily disabled — see MONITORING_DISABLED in this route.' },
      { status: 503 },
    );
  }

  const windowStart = new Date(Date.now() - COUNTS_WINDOW_MS);

  const [eventsSnap, alertsSnap] = await Promise.all([
    firestore()
      .collection('monitoringEvents')
      .where('createdAt', '>=', windowStart)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get(),
    firestore().collection('monitoringAlerts').orderBy('updatedAt', 'desc').limit(20).get(),
  ]);

  const events = eventsSnap.docs.map((d) => {
    const data = d.data();
    return {
      type: data.type as string,
      severity: data.severity as string,
      summary: data.summary as string,
      createdAt: (data.createdAt as { toDate(): Date }).toDate().toISOString(),
    };
  });

  const counts = {
    signups: events.filter((e) => e.type === 'ss').length,
    loginsSuccess: events.filter((e) => e.type === 's').length,
    loginsFailed: events.filter((e) => ['f', 'fu', 'fp'].includes(e.type)).length,
  };

  const alerts = alertsSnap.docs.map((d) => {
    const data = d.data();
    return {
      ruleId: data.ruleId as string,
      severity: data.severity as string,
      title: data.title as string,
      detail: data.detail as string,
      status: data.status as string,
      updatedAt: (data.updatedAt as { toDate(): Date }).toDate().toISOString(),
    };
  });

  return NextResponse.json({
    counts,
    activeAlerts: alerts.filter((a) => a.status === 'active').length,
    alerts,
    recentEvents: events.slice(0, 50),
  });
}
