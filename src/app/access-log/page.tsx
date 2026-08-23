import { auth0 } from '@/lib/auth0';
import { db } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

const LABELS: Record<string, string> = {
  check: 'Access check',
  tuple_write: 'Delegation granted',
  tuple_delete: 'Delegation revoked',
  obo_exchange: 'Cross-service token exchange',
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

  const events = await db.query.auditEvents.findMany({
    where: eq(auditEvents.citizenUserId, session.user.sub),
    orderBy: [desc(auditEvents.createdAt)],
    limit: 100,
  });

  return (
    <main className="mx-auto max-w-2xl p-6">
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
              {e.subject} {e.relation ? `→ ${e.relation}` : ''} {e.object ? `on ${e.object}` : ''}
              {e.decision !== null && (
                <span className={e.decision ? 'text-green-700' : 'text-red-700'}>
                  {' '}
                  — {e.decision ? 'allowed' : 'denied'}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
