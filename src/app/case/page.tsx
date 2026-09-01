import { auth0 } from '@/lib/auth0';
import { checkAndLog } from '@/lib/fga';
import { caseIdFor, ensureCitizenProvisioned, findCaseById } from '@/lib/provisioning';
import { isCaseworker } from '@/lib/roles';
import Link from 'next/link';

// Pulled out of the component body so the render function itself stays
// pure (no direct Date.now() call during render) - createdAt within the
// last 30s is a cheap, good-enough proxy for "this is the render right
// after provisioning happened," no new schema needed.
function wasJustProvisioned(createdAt: Date | undefined) {
  return Boolean(createdAt && Date.now() - createdAt.getTime() < 30_000);
}

export default async function CasePage() {
  const session = await auth0.getSession();
  if (!session) {
    return (
      <main className="p-6">
        <a href="/auth/login" className="text-blue-600 underline">
          Log in to view your case
        </a>
      </main>
    );
  }

  const citizenUserId = session.user.sub;
  const { case: row } = await ensureCitizenProvisioned(citizenUserId);

  // The citizen's own view goes through the exact same wrapper as the
  // agent's — on the `owner` relation, which is always granted at
  // creation. This is deliberate, not decorative: it's what makes the
  // Access Log's "human viewed, allowed / agent requested, denied" pairing
  // meaningful rather than one side being real and the other cosmetic.
  await checkAndLog({
    citizenUserId,
    subject: `user:${citizenUserId}`,
    relation: 'owner',
    object: caseIdFor(row.id),
  });

  const fresh = await findCaseById(row.id);

  // No client-visible loading gap to add a spinner to — provisioning
  // (FGA owner tuple + case/agent docs) already completed synchronously,
  // either via the post-login Action before the redirect or via this
  // same ensureCitizenProvisioned call just above as a fallback. What's
  // missing per the build plan isn't a loading state, it's telling a
  // first-time visitor what that brief redirect pause was actually doing.
  const justProvisioned = wasJustProvisioned(fresh?.createdAt);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Your case</h1>
      {justProvisioned && (
        <p className="mt-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
          While you were signing up, this app set up your case record and granted your AI
          assistant&apos;s starting permissions - the same kind of check every request it makes
          will go through from now on.
        </p>
      )}
      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <dt className="text-gray-500">Case ID</dt>
          <dd>{fresh?.id}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Status</dt>
          <dd>{fresh?.status}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Assessment date</dt>
          <dd>{fresh?.assessmentTime.toDateString()}</dd>
        </div>
      </dl>

      <p className="mt-6 text-sm text-gray-700 dark:text-gray-300">
        Every time your assistant answers a question about this case, it makes a real API call
        that&apos;s checked against{' '}
        <a
          className="text-blue-600 underline"
          href="https://auth0.com/docs/secure/fine-grained-authorization"
        >
          Auth0 FGA
        </a>{' '}
        (fine-grained authorisation) - a system that decides, fresh on every single request,
        exactly what your assistant is allowed to see. There&apos;s no insecure version of this
        app to show you first, because nothing here ever skips that check.
      </p>

      <details className="mt-3 rounded border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          What would an insecure version look like?
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-green-700 dark:text-green-400">
              What this app actually does
            </div>
            <pre className="overflow-x-auto rounded bg-black/80 p-2 text-[11px] text-green-300">
{`await checkAndLog({
  citizenUserId,
  subject: \`agent:\${userId}-assistant\`,
  relation: 'agent_delegate',
  object: caseId,
});
// only proceeds if this returns true`}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-red-700 dark:text-red-400">
              What an over-privileged service credential would look like instead
            </div>
            <pre className="overflow-x-auto rounded bg-black/80 p-2 text-[11px] text-red-300">
{`// never executed anywhere in this app
db.query.cases.findFirst({
  where: eq(cases.citizenUserId, targetUserId),
});
// no check at all - it would just work,
// and that's the problem`}
            </pre>
          </div>
        </div>
      </details>

      <div className="mt-6 flex gap-4 text-sm">
        <Link className="text-blue-600 underline" href="/">
          Home
        </Link>
        <Link className="text-blue-600 underline" href="/chat">
          Talk to your assistant
        </Link>
        <Link className="text-blue-600 underline" href="/access-log">
          View access log
        </Link>
        <Link className="text-blue-600 underline" href="/recap">
          What you just saw
        </Link>
        {isCaseworker(session) && (
          <Link className="text-blue-600 underline" href="/admin">
            Admin console
          </Link>
        )}
        <a className="text-blue-600 underline" href="/auth/logout">
          Log out
        </a>
      </div>
    </main>
  );
}
