import type { Metadata } from 'next';
import { auth0 } from '@/lib/auth0';
import { firestore } from '@/lib/firebase-admin';
import { isCaseworker } from '@/lib/roles';
import type { AuditEventRecord } from '@/lib/provisioning';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Access Log' };

// status_change is only ever produced by logAppealRevoked (lib/fga.ts)
// today - if a second status_change use appears, this label needs to
// read detail.note instead of assuming every status_change means the
// same thing.
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
        <a href="/auth/login" className="text-blue-600 underline">
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

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex gap-4 text-sm">
        <Link className="text-blue-600 underline" href="/">Home</Link>
        {isCaseworker(session) ? (
          <Link className="text-blue-600 underline" href="/admin">Admin console</Link>
        ) : (
          <>
            <Link className="text-blue-600 underline" href="/case">My case</Link>
            <Link className="text-blue-600 underline" href="/chat">Chat</Link>
          </>
        )}
        <Link className="text-blue-600 underline" href="/recap">What you just saw</Link>
        <a className="text-blue-600 underline" href="/auth/logout">Log out</a>
      </div>
      <h1 className="text-xl font-semibold">Your access log</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every time your case was viewed or your assistant tried to act on your behalf, deterministically
        checked and recorded here — not inferred from a chat transcript.
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {events.map((e) => (
          <li key={e.id} className="rounded border px-3 py-2">
            <div className="flex justify-between">
              <span className="font-medium">{LABELS[e.eventType] ?? e.eventType}</span>
              <span className="text-gray-400">{e.createdAt.toLocaleTimeString()}</span>
            </div>
            <div className="text-gray-600">
              {e.actingPrincipal} {e.relation ? `→ ${e.relation}` : ''} {e.object ? `on ${e.object}` : ''}
              {e.decision !== null && (
                <span className={e.decision ? 'text-green-700' : 'text-red-700'}>
                  {' '}
                  — {e.decision ? 'allowed' : 'denied'}
                </span>
              )}
            </div>
            {e.verifiedActor && (
              <div className="text-xs text-gray-400">
                token-verified actor: {e.verifiedActor}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
