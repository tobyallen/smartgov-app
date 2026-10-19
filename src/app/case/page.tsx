import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth0 } from '@/lib/auth0';
import { checkAndLog } from '@/lib/fga';
import { caseIdFor, ensureCitizenProvisioned, findCaseById } from '@/lib/provisioning';
import { isCaseworker } from '@/lib/roles';
import OneTimeNote from '@/components/OneTimeNote';
import { RevokeAppealButton } from '@/components/RevokeAppealButton';
import { ResetMyDataButton } from '@/components/ResetMyDataButton';
import { AppNav, type NavLink } from '@/components/AppNav';

export const metadata: Metadata = { title: 'My Case' };

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
        <a href="/auth/login" className="text-brand-primary underline hover:text-brand-primary-hover">
          Log in to view your case
        </a>
      </main>
    );
  }

  // This page is citizen-only content - a caseworker has no case record
  // and shouldn't get one created for them just by visiting here (found
  // via a real question: "a caseworker doesn't have access to the case
  // page, how would they reset their usage" - ensureCitizenProvisioned
  // below was running unconditionally for anyone signed in, silently
  // creating a nonsensical citizen case/agent doc for a caseworker
  // account). /admin is the caseworker's equivalent surface, including
  // its own reset button - see ResetMyDataButton there.
  if (isCaseworker(session)) {
    redirect('/admin');
  }

  const citizenUserId = session.user.sub;
  const { case: row } = await ensureCitizenProvisioned(citizenUserId);

  // The citizen's own view goes through the exact same wrapper as the
  // agent's — on the `owner` relation, which is always granted at
  // creation. This is deliberate, not decorative: it's what makes the
  // Access Log's "human viewed, allowed / agent requested, denied" pairing
  // meaningful rather than one side being real and the other cosmetic.
  await checkAndLog({
    onBehalfOf: citizenUserId,
    actingPrincipal: `user:${citizenUserId}`,
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

  const navLinks: NavLink[] = [
    { label: 'Home', href: '/' },
    { label: 'Talk to your assistant', href: '/chat' },
    { label: 'View access log', href: '/access-log' },
    { label: 'What you just saw', href: '/recap' },
    { label: 'Log out', href: '/auth/logout', role: 'destructive' },
  ];

  return (
    <main className="mx-auto max-w-2xl p-6">
      <AppNav links={navLinks} />
      <h1 className="text-xl font-semibold text-ink-primary">Your case</h1>
      <OneTimeNote step="case-provisioning-note-seen" initiallyEligible={justProvisioned}>
        <p className="mt-2 rounded border border-brand-primary/30 bg-brand-primary/10 p-3 text-sm text-ink-primary">
          While you were signing up, this app set up your case record and granted your AI
          assistant&apos;s starting permissions - the same kind of check every request it makes
          will go through from now on.
        </p>
      </OneTimeNote>
      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <dt className="text-ink-muted">Case ID</dt>
          <dd>{fresh?.id}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Status</dt>
          <dd>{fresh?.status}</dd>
          {fresh?.status === 'appeal_submitted' && <RevokeAppealButton />}
        </div>
        <div>
          <dt className="text-ink-muted">Assessment date</dt>
          <dd>{fresh?.assessmentTime.toDateString()}</dd>
        </div>
      </dl>

      <OneTimeNote step="case-fga-explainer-seen">
        <p className="mt-6 text-sm text-ink-secondary">
          Every time your assistant answers a question about this case, it makes a real API call
          that&apos;s checked against{' '}
          <a
            className="text-brand-primary underline hover:text-brand-primary-hover inline-flex items-center gap-1"
            href="https://auth0.com/docs/secure/fine-grained-authorization"
            target="_blank"
            rel="noreferrer"
          >
            Auth0 FGA
          </a>{' '}
          (fine-grained authorisation - links to Auth0&apos;s own docs on the ReBAC model this
          demo uses) - a system that decides, fresh on every single request, exactly what your
          assistant is allowed to see. It&apos;s a ReBAC (relationship-based access control)
          system underneath: access is decided by the actual relationships between your assistant
          and your case, not by a static list of permissions. So you won&apos;t see this app in a
          mode that skips the check - the comparison below is illustrative code only, never a
          live toggle.
        </p>
      </OneTimeNote>

      <details className="mt-3 rounded border border-surface-hairline p-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink-primary">
          What would an insecure version look like?
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-status-good">
              What this app actually does
            </div>
            <pre className="overflow-x-auto rounded bg-black p-2 text-[11px] text-status-good">
{`await checkAndLog({
  onBehalfOf: citizenUserId,
  actingPrincipal: \`agent:\${userId}-assistant\`,
  relation: 'agent_delegate',
  object: caseId,
});
// only proceeds if this returns true`}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-status-critical">
              What an over-privileged service credential would look like instead
            </div>
            <pre className="overflow-x-auto rounded bg-black p-2 text-[11px] text-status-critical">
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

      <div className="mt-6 border-t border-surface-hairline pt-4">
        <ResetMyDataButton />
      </div>
    </main>
  );
}
