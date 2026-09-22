import { NextRequest, NextResponse } from 'next/server';
import { firestore } from '@/lib/firebase-admin';
import { fetchAuth0LogsSince, eventDocId } from '@/lib/monitoring/auth0Logs';
import { acquireCollectorLock, releaseCollectorLock, getAuth0Checkpoint, advanceAuth0Checkpoint } from '@/lib/monitoring/checkpoints';
import { evaluateAlertRules } from '@/lib/monitoring/alerts';

/**
 * GET /api/monitoring/collect — cron-triggered ingestion. Vercel Cron
 * invokes the configured `path` with GET, not POST (confirmed against
 * Vercel's own cron docs) - an earlier draft of this plan spec'd POST
 * and would have 405'd on every single invocation.
 *
 * Gated by comparing the Authorization header against CRON_SECRET, the
 * pattern Vercel's own docs recommend for securing cron routes -
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 *
 * Single-flight locked (checkpoints.ts) since Vercel Cron doesn't
 * guarantee non-overlapping invocations. Checkpoint only advances after
 * a successful write, so a partial failure re-processes (not skips) the
 * same batch on the next poll - safe because monitoringEvents writes are
 * keyed by the source log's own ID (see eventDocId), making re-processing
 * an overwrite rather than a duplicate.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const gotLock = await acquireCollectorLock();
  if (!gotLock) {
    return NextResponse.json({ skipped: true, reason: 'collector already running' });
  }

  const result: { auth0: { ok: boolean; eventsWritten: number; error?: string }; alerts: { ok: boolean; error?: string } } = {
    auth0: { ok: false, eventsWritten: 0 },
    alerts: { ok: false },
  };

  try {
    try {
      const lastLogId = await getAuth0Checkpoint();
      const { events, newestLogId } = await fetchAuth0LogsSince(lastLogId);

      if (events.length > 0) {
        const batch = firestore().batch();
        for (const event of events) {
          const ref = firestore().collection('monitoringEvents').doc(eventDocId(event));
          batch.set(ref, event);
        }
        await batch.commit();
      }

      // Only reached if the write above succeeded — see module comment.
      if (newestLogId && newestLogId !== lastLogId) {
        await advanceAuth0Checkpoint(newestLogId);
      }

      result.auth0 = { ok: true, eventsWritten: events.length };
    } catch (err) {
      result.auth0 = { ok: false, eventsWritten: 0, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      await evaluateAlertRules(new Date());
      result.alerts = { ok: true };
    } catch (err) {
      result.alerts = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    return NextResponse.json(result, { status: result.auth0.ok && result.alerts.ok ? 200 : 207 });
  } finally {
    await releaseCollectorLock();
  }
}
