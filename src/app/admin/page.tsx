import { auth0 } from '@/lib/auth0';
import { isCaseworker } from '@/lib/roles';
import AdminChat from './AdminChat';
import Link from 'next/link';

// RBAC check happens server-side, before any client component ever
// mounts — a citizen hitting this URL directly gets a plain, honest
// refusal, not a chat UI that silently 403s on every tool call.
export default async function AdminPage() {
  const session = await auth0.getSession();
  if (!session) {
    return (
      <main className="p-6">
        <a href="/auth/login" className="text-blue-600 underline">
          Log in to view the admin console
        </a>
      </main>
    );
  }

  if (!isCaseworker(session.user)) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <div className="mb-4 flex gap-4 text-sm">
          <Link className="text-blue-600 underline" href="/">Home</Link>
          <Link className="text-blue-600 underline" href="/case">My case</Link>
          <Link className="text-blue-600 underline" href="/chat">Chat</Link>
        </div>
        <h1 className="text-xl font-semibold">Not available</h1>
        <p className="mt-2 text-sm text-gray-600">
          The admin console is only available to caseworker accounts. You&apos;re signed in as a
          citizen — this isn&apos;t a system error, it&apos;s the same RBAC check that keeps
          citizen sessions from ever seeing the contractor-management tools.
        </p>
      </main>
    );
  }

  return <AdminChat />;
}
