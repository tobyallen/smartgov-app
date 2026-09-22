import type { Metadata } from 'next';
import { auth0 } from '@/lib/auth0';
import { hasDevToolsRole } from '@/lib/roles';
import { DevResetPanel } from '@/components/DevResetPanel';
import { AppNav } from '@/components/AppNav';

export const metadata: Metadata = { title: 'Dev Tools' };

// Gated purely on the dev-tools role - deliberately independent of
// citizen/caseworker persona (see /admin's isCaseworker gate, /case's
// citizen-provisioning logic), since a dev-tools account could hold
// either persona and this page shouldn't assume one. dev-tools has no
// self-service grant path anywhere in this app (assign-persona-role.js,
// the build plan's "Reruns" section) - reaching this URL proves nothing
// on its own, the actual gate is server-side on every /api/dev/reset
// call, this page is just where the form for it lives.
export default async function DevToolsPage() {
  const session = await auth0.getSession();
  if (!session) {
    return (
      <main className="p-6">
        <a href="/auth/login" className="text-brand-primary underline hover:text-brand-primary-hover">
          Log in
        </a>
      </main>
    );
  }

  if (!hasDevToolsRole(session)) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <AppNav links={[{ label: 'Home', href: '/' }, { label: 'My case', href: '/case' }]} />
        <h1 className="text-xl font-semibold text-ink-primary">Not available</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          This page is only available to accounts with the dev-tools role, which has no
          self-service grant path — it&apos;s assigned manually for rehearsal use.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <AppNav
        links={[
          { label: 'Home', href: '/' },
          { label: 'My case', href: '/case' },
          { label: 'Log out', href: '/auth/logout', role: 'destructive' },
        ]}
      />
      <h1 className="text-xl font-semibold text-ink-primary">Dev tools</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Rehearsal utilities, not part of the demo narration. Resets are real deletes against the
        live Auth0 FGA store and Firestore project — there&apos;s no undo.
      </p>
      <DevResetPanel />
    </main>
  );
}
