import type { Metadata } from 'next';
import { auth0 } from '@/lib/auth0';
import { isCaseworker } from '@/lib/roles';
import { ensureCaseworkerProvisioned } from '@/lib/provisioning';
import AdminChat from './AdminChat';
import { AppNav } from '@/components/AppNav';

export const metadata: Metadata = { title: 'Admin Console' };

// RBAC check happens server-side, before any client component ever
// mounts — a citizen hitting this URL directly gets a plain, honest
// refusal, not a chat UI that silently 403s on every tool call.
export default async function AdminPage() {
  const session = await auth0.getSession();
  if (!session) {
    return (
      <main className="p-6">
        <a href="/auth/login" className="text-brand-primary underline hover:text-brand-primary-hover">
          Log in to view the admin console
        </a>
      </main>
    );
  }

  if (!isCaseworker(session)) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <AppNav
          links={[
            { label: 'Home', href: '/' },
            { label: 'My case', href: '/case' },
            { label: 'Chat', href: '/chat' },
          ]}
        />
        <h1 className="text-xl font-semibold text-ink-primary">Not available</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          The admin console is only available to caseworker accounts. You&apos;re signed in as a
          citizen — this isn&apos;t a system error, it&apos;s the same RBAC check that keeps
          citizen sessions from ever seeing the contractor-management tools.
        </p>
      </main>
    );
  }

  // Lazy safety net, same pattern as ensureCitizenProvisioned() being
  // called from /case and /chat: if the Action's synchronous seed call
  // ever failed (network blip, secret misconfigured), this is what
  // actually recovers a caseworker whose contractor tools would otherwise
  // stay permanently denied. Idempotent - re-running it here on every
  // /admin visit is a no-op once the grants already exist.
  await ensureCaseworkerProvisioned(session.user.sub);

  return <AdminChat />;
}
