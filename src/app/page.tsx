import { auth0 } from '@/lib/auth0';
import { isCaseworker } from '@/lib/roles';

export default async function Home() {
  const session = await auth0.getSession();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">SmartGov Citizen Portal</h1>
      <p className="mt-2 text-sm text-gray-600">
        Sovereign Intelligence: your AI assistant only sees what you explicitly let it see —
        and every decision is checked, not assumed.
      </p>
      {session ? (
        <div className="mt-6 flex gap-4 text-sm">
          <a className="text-blue-600 underline" href="/case">My case</a>
          <a className="text-blue-600 underline" href="/chat">Chat with my assistant</a>
          <a className="text-blue-600 underline" href="/access-log">Access log</a>
          <a className="text-blue-600 underline" href="/recap">What you just saw</a>
          {isCaseworker(session) && (
            <a className="text-blue-600 underline" href="/admin">Admin console</a>
          )}
          <a className="text-blue-600 underline" href="/auth/logout">Log out</a>
        </div>
      ) : (
        <div className="mt-6">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            This is a live demo, not a slide. Sign up with any email - even a throwaway one,
            nothing here is real - and pick a role below. You&apos;ll see your AI assistant get
            checked against a real authorisation model on every single request it makes on your
            behalf, and you&apos;ll be able to turn its access on and off and watch the check
            change live.
          </p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row">
            <div>
              <a
                className="inline-block rounded bg-blue-600 px-4 py-2 text-sm text-white"
                href="/auth/login?persona=citizen"
              >
                Continue as a citizen
              </a>
              <p className="mt-1 max-w-xs text-xs text-gray-500">
                Sign up for your own case and control what your AI assistant is allowed to see.
              </p>
            </div>
            <div>
              <a
                className="inline-block rounded bg-gray-700 px-4 py-2 text-sm text-white"
                href="/auth/login?persona=caseworker"
              >
                Continue as a caseworker
              </a>
              <p className="mt-1 max-w-xs text-xs text-gray-500">
                Sign up with access to the admin tool surface - the same account, checked by a
                different role.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
