import type { Metadata } from 'next';
import { auth0 } from '@/lib/auth0';
import { isCaseworker, personaFor } from '@/lib/roles';
import { AppNav, type NavLink } from '@/components/AppNav';

export const metadata: Metadata = { title: 'Home' };

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ attemptedPersona?: string }>;
}) {
  const session = await auth0.getSession();
  const { attemptedPersona } = await searchParams;

  // assign-persona-role.js only ever decides a persona on a user's
  // first-ever login - app_metadata.persona (and the role it maps to)
  // never changes on a later login, even if the returning user clicks
  // the OTHER button and its ?persona= query param rides along again.
  // That means clicking "Continue as a caseworker" as an already-citizen
  // account is not an error, but it's also not a role switch - it just
  // silently signs them back in as the citizen they already are, with
  // no indication anything was ignored. attemptedPersona survives the
  // login round trip via returnTo (see the two buttons below) so this
  // page can compare what was actually clicked against the persona the
  // session actually landed with, and say so plainly instead of leaving
  // it to look like the click did nothing.
  const actualPersona = session ? personaFor(session) : null;
  const personaMismatch =
    session && attemptedPersona && attemptedPersona !== actualPersona;

  const navLinks: NavLink[] = session
    ? [
        ...(isCaseworker(session)
          ? [{ label: 'Admin console', href: '/admin' }]
          : [
              { label: 'My case', href: '/case' },
              { label: 'Chat with my assistant', href: '/chat' },
            ]),
        { label: 'Access log', href: '/access-log' },
        { label: 'What you just saw', href: '/recap' },
        { label: 'Log out', href: '/auth/logout', role: 'destructive' as const },
      ]
    : [];

  return (
    <main className="mx-auto max-w-2xl p-6">
      {session && <AppNav links={navLinks} />}
      <h1 className="text-2xl font-semibold text-ink-primary">SmartGov Citizen Portal</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Sovereign Intelligence: your AI assistant only sees what you explicitly let it see —
        and every decision is checked, not assumed.
      </p>
      {personaMismatch && (
        <div className="mt-4 rounded border border-status-warning bg-status-warning/10 px-3 py-2 text-sm text-ink-primary">
          You&apos;re signed in as a <strong>{actualPersona}</strong>, not a{' '}
          <strong>{attemptedPersona}</strong> - a persona is fixed to an account the moment it
          first signs up, and doesn&apos;t change on a later login even if you click the other
          button. To try the {attemptedPersona} side,{' '}
          <a className="text-ink-secondary underline hover:text-ink-primary" href="/auth/logout">
            log out
          </a>{' '}
          and sign up again with a different email as a {attemptedPersona}.
        </div>
      )}
      {!session && (
        <div className="mt-6">
          <p className="text-sm text-ink-secondary">
            This is a live demo, not a slide. Sign up with any email - even a throwaway one,
            nothing here is real - and pick a role below. You&apos;ll see your AI assistant get
            checked against a real authorisation model on every single request it makes on your
            behalf, and you&apos;ll be able to turn its access on and off and watch the check
            change live.
          </p>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row">
            <div>
              <a
                className="inline-block rounded bg-brand-primary px-4 py-2 text-sm text-white hover:bg-brand-primary-hover"
                href="/auth/login?persona=citizen&returnTo=%2F%3FattemptedPersona%3Dcitizen"
              >
                Continue as a citizen
              </a>
              <p className="mt-1 max-w-xs text-xs text-ink-muted">
                Sign up for your own case and control what your AI assistant is allowed to see.
                Already have a caseworker account? Use a different email - a persona is fixed to
                an account for good at signup.
              </p>
            </div>
            <div>
              <a
                className="inline-block rounded bg-ink-secondary px-4 py-2 text-sm text-white hover:bg-ink-primary"
                href="/auth/login?persona=caseworker&returnTo=%2F%3FattemptedPersona%3Dcaseworker"
              >
                Continue as a caseworker
              </a>
              <p className="mt-1 max-w-xs text-xs text-ink-muted">
                Sign up with access to the admin tool surface. Already have a citizen account?
                Use a different email - a persona is fixed to an account for good at signup.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
