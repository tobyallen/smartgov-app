import type { Metadata } from 'next';
import { auth0 } from '@/lib/auth0';
import { hasDevToolsRole } from '@/lib/roles';
import { AppNav } from '@/components/AppNav';
import { MonitoringDashboard } from '@/components/MonitoringDashboard';

export const metadata: Metadata = { title: 'Monitoring' };

// Gated on the dev-tools role, same pattern as /dev-tools and the same
// reasoning: this is operator tooling for watching the live event, not
// something any citizen/caseworker persona should reach, and dev-tools
// already has no self-service grant path anywhere in this app.
export default async function MonitoringPage() {
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
          self-service grant path — it&apos;s assigned manually for rehearsal/operator use.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <AppNav
        links={[
          { label: 'Home', href: '/' },
          { label: 'Dev tools', href: '/dev-tools' },
          { label: 'Log out', href: '/auth/logout', role: 'destructive' },
        ]}
      />
      <h1 className="text-xl font-semibold text-ink-primary">Monitoring</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Signup/login volume and flagged issues from Auth0 tenant logs. Click Refresh for the
        latest data — this page does not update on its own.
      </p>
      <MonitoringDashboard />
    </main>
  );
}
