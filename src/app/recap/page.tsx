import { auth0 } from '@/lib/auth0';
import { firestore } from '@/lib/firebase-admin';
import { isCaseworker } from '@/lib/roles';
import Link from 'next/link';

export default async function RecapPage() {
  const session = await auth0.getSession();
  if (!session) {
    return (
      <main className="p-6">
        <a href="/auth/login" className="text-blue-600 underline">
          Log in to view the recap
        </a>
      </main>
    );
  }

  // "Have they used the core flow at least once" reuses the existing
  // auditEvents trail rather than new state - any event at all under
  // this uid means at least one real check has happened.
  const snap = await firestore()
    .collection('auditEvents')
    .where('onBehalfOf', '==', session.user.sub)
    .limit(1)
    .get();
  const hasUsedTheFlow = !snap.empty;

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
        <Link className="text-blue-600 underline" href="/access-log">Access log</Link>
        <a className="text-blue-600 underline" href="/auth/logout">Log out</a>
      </div>

      <h1 className="text-xl font-semibold">What you just saw</h1>

      {!hasUsedTheFlow && (
        <p className="mt-2 text-sm text-gray-600">
          Nothing&apos;s been checked under your account yet - try{' '}
          <Link className="text-blue-600 underline" href="/chat">chatting with your assistant</Link>{' '}
          first, then come back here.
        </p>
      )}

      <p className="mt-4 text-sm text-gray-700 dark:text-gray-300">
        Granting and revoking your assistant&apos;s access, and watching a caseworker&apos;s
        actions get checked against both a role and a live authorisation model, turns what&apos;s
        normally an invisible question - &quot;did the AI have access, on whose authority, for
        how long?&quot; - into something accountable: revocable in real time, and recorded in a
        machine-readable audit trail rather than inferred from a chat transcript.
      </p>

      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
        <li>
          <strong>RBAC</strong> decided which tools existed for your role before you ever typed
          anything.
        </li>
        <li>
          <strong>Auth0 FGA</strong> decided, fresh on every single request, exactly what your
          assistant (a separate identity from you) was allowed to do.
        </li>
        <li>
          Every one of those decisions is sitting in your{' '}
          <Link className="text-blue-600 underline" href="/access-log">access log</Link>, not
          reconstructed after the fact from a chat transcript.
        </li>
      </ul>

      <div className="mt-6 flex gap-4 text-sm">
        <a className="text-blue-600 underline" href="https://github.com/tobyallen/smartgov-app">
          Repo
        </a>
        <a
          className="text-blue-600 underline"
          href="https://github.com/tobyallen/smartgov-app/blob/main/fga-model.fga"
        >
          FGA model
        </a>
        <a
          className="text-blue-600 underline"
          href="https://github.com/tobyallen/smartgov-app/blob/main/src/app/api/admin-mcp/route.ts"
        >
          MCP server code
        </a>
      </div>
    </main>
  );
}
