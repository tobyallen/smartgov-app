import type { Metadata } from 'next';
import { auth0 } from '@/lib/auth0';
import { firestore } from '@/lib/firebase-admin';
import { isCaseworker } from '@/lib/roles';
import type { AuditEventRecord } from '@/lib/provisioning';
import { AppNav, type NavLink } from '@/components/AppNav';

export const metadata: Metadata = { title: 'Access Log' };

// status_change is only ever produced by logAppealRevoked (lib/fga.ts)
// today - if a second status_change use appears, this label needs to
// read detail.note instead of assuming every status_change means the
// same thing. AuditEventRecord's eventType union now includes
// 'status_change' explicitly (fixed 2026-09-22 - it had been missing
// despite being real and already handled here, a stale-type gap, not a
// runtime bug).
const LABELS: Record<string, string> = {
  check: 'Access check',
  tuple_write: 'Delegation granted',
  tuple_delete: 'Delegation revoked',
  obo_exchange: 'Cross-service token exchange',
  status_change: 'Appeal revoked',
};

export default async function AccessLogPage() {
  const session = await auth0.getSession();
  if (!session) {
    return (
      <main className="p-6">
        <a href="/auth/login" className="text-brand-primary underline hover:text-brand-primary-hover">
          Log in to view your access log
        </a>
      </main>
    );
  }

  const snap = await firestore()
    .collection('auditEvents')
    .where('onBehalfOf', '==', session.user.sub)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  const events: AuditEventRecord[] = snap.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      onBehalfOf: data.onBehalfOf,
      eventType: data.eventType,
      actingPrincipal: data.actingPrincipal,
      relation: data.relation ?? null,
      object: data.object ?? null,
      context: data.context ?? null,
      decision: data.decision ?? null,
      detail: data.detail ?? null,
      verifiedActor: data.verifiedActor ?? null,
      createdAt: data.createdAt.toDate(),
    };
  });

  const navLinks: NavLink[] = [
    { label: 'Home', href: '/' },
    ...(isCaseworker(session)
      ? [{ label: 'Admin console', href: '/admin' }]
      : [
          { label: 'My case', href: '/case' },
          { label: 'Chat', href: '/chat' },
        ]),
    { label: 'What you just saw', href: '/recap' },
    { label: 'Log out', href: '/auth/logout', role: 'destructive' as const },
  ];

  return (
    <main className="mx-auto max-w-2xl p-6">
      <AppNav links={navLinks} />
      <h1 className="text-xl font-semibold text-ink-primary">Your access log</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Every time your case was viewed or your assistant tried to act on your behalf, deterministically
        checked and recorded here — not inferred from a chat transcript.
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {events.map((e) => {
          // e.detail/e.context come straight from Firestore with no
          // runtime validation - guarded here (adversarial review,
          // 2026-09-22) rather than trusted as the shape the type
          // annotation claims, since a malformed or pre-migration row
          // (an older obo_exchange event never had fromService/toService
          // at all) must degrade to the raw value, not crash the page or
          // render an object as a React child.
          const rawDetail = e.detail;
          const detail =
            rawDetail && typeof rawDetail === 'object' && !Array.isArray(rawDetail) ? rawDetail : null;
          const fromService = typeof detail?.fromService === 'string' ? detail.fromService : null;
          const toService = typeof detail?.toService === 'string' ? detail.toService : null;
          const audience = typeof detail?.audience === 'string' ? detail.audience : null;
          const isOboExchange = e.eventType === 'obo_exchange';

          const rawContext = e.context;
          const context =
            rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext) ? rawContext : null;

          return (
            <li key={e.id} className="rounded border border-surface-hairline px-3 py-2">
              <div className="flex justify-between">
                <span className="font-medium text-ink-primary">{LABELS[e.eventType] ?? e.eventType}</span>
                <span className="text-ink-muted">{e.createdAt.toLocaleTimeString()}</span>
              </div>
              {isOboExchange ? (
                // The whole point of surfacing this: which real backend
                // service exchanged a token to reach which downstream
                // service, on this specific request - previously only
                // ever distinguishable (if at all) by comparing raw
                // audience URLs, and detail wasn't rendered on this page
                // at all before this fix. Falls back to the raw audience
                // for an older event written before fromService/toService
                // existed, rather than the generic actingPrincipal line
                // every other event type uses (which for obo_exchange is
                // always just `user:<uid>`, uninformative on its own).
                <div className="text-ink-secondary">
                  {fromService && toService ? (
                    <>
                      <span className="font-medium">{fromService}</span>
                      <span className="text-ink-muted"> → </span>
                      <span className="font-medium">{toService}</span>
                    </>
                  ) : (
                    <>
                      Exchanged a token{audience ? ' for ' : ''}
                      {audience && <span className="font-medium">{audience}</span>}
                    </>
                  )}
                </div>
              ) : (
                <div className="text-ink-secondary">
                  {e.actingPrincipal} {e.relation ? `→ ${e.relation}` : ''} {e.object ? `on ${e.object}` : ''}
                  {e.decision !== null && (
                    <span className={e.decision ? 'text-status-good' : 'text-status-critical'}>
                      {' '}
                      — {e.decision ? 'allowed' : 'denied'}
                    </span>
                  )}
                </div>
              )}
              {e.verifiedActor && (
                <div className="text-xs text-ink-muted">
                  token-verified actor: {e.verifiedActor}
                </div>
              )}
              {e.eventType === 'check' && context && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-ink-muted">
                    Why this decision, right now
                  </summary>
                  <div className="mt-1 rounded bg-ink-secondary/5 p-2 text-xs text-ink-secondary">
                    {Object.entries(context).map(([key, value]) => (
                      <div key={key}>
                        {key}: {String(value)}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
