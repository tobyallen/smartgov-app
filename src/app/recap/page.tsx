import type { Metadata } from 'next';
import { auth0 } from '@/lib/auth0';
import { firestore } from '@/lib/firebase-admin';
import { isCaseworker } from '@/lib/roles';
import Link from 'next/link';
import { AppNav, ExternalIcon, type NavLink } from '@/components/AppNav';

export const metadata: Metadata = { title: 'Recap' };

export default async function RecapPage() {
  const session = await auth0.getSession();
  if (!session) {
    return (
      <main className="p-6">
        <a href="/auth/login" className="text-brand-primary underline hover:text-brand-primary-hover">
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

  const navLinks: NavLink[] = [
    { label: 'Home', href: '/' },
    ...(isCaseworker(session)
      ? [{ label: 'Admin console', href: '/admin' }]
      : [
          { label: 'My case', href: '/case' },
          { label: 'Chat', href: '/chat' },
        ]),
    { label: 'Access log', href: '/access-log' },
    { label: 'Log out', href: '/auth/logout', role: 'destructive' as const },
  ];

  return (
    <main className="mx-auto max-w-2xl p-6">
      <AppNav links={navLinks} />

      <h1 className="text-xl font-semibold text-ink-primary">What you just saw</h1>

      {!hasUsedTheFlow && (
        <p className="mt-2 text-sm text-ink-secondary">
          Nothing&apos;s been checked under your account yet - try{' '}
          <Link className="text-brand-primary underline hover:text-brand-primary-hover" href="/chat">
            chatting with your assistant
          </Link>{' '}
          first, then come back here.
        </p>
      )}

      <p className="mt-4 text-sm text-ink-secondary">
        Granting and revoking your assistant&apos;s access, and watching a caseworker&apos;s
        actions get checked against both a role and a live authorisation model, turns what&apos;s
        normally an invisible question - &quot;did the AI have access, on whose authority, for
        how long?&quot; - into something accountable: revocable in real time, and recorded in a
        machine-readable audit trail rather than inferred from a chat transcript.
      </p>

      <div className="mt-4 space-y-4 text-sm text-ink-secondary">
        <p>
          <strong>RBAC decided which tools existed for your role before you ever typed anything.</strong>{' '}
          A citizen account never even sees contractor-management tools listed — they&apos;re not
          hidden or greyed out, they don&apos;t exist for that identity. This is the coarse,
          cheap-to-reason-about layer: a role check that runs once, at the boundary, before any
          specific resource is even in view.
        </p>
        <p>
          <strong>
            Auth0 FGA decided, fresh on every single request, exactly what your assistant (a
            separate identity from you) was allowed to do.
          </strong>{' '}
          This is the layer RBAC alone can&apos;t do: RBAC answers &quot;can this role use this
          tool at all,&quot; but not &quot;is this specific assistant allowed to touch this
          specific case, right now.&quot; That&apos;s a relationship (ReBAC) — the assistant&apos;s
          delegated relationship to your case — evaluated against live conditions (a 15-minute
          delegation window, a 30-day appeal window, a 5-minute step-up window), not a static
          permission that&apos;s either granted or not. A plain role could never expire on its own
          the way a condition can; that self-expiry is the whole reason the demo&apos;s delegation
          toggle is interesting instead of just being another checkbox.
        </p>
        <p>
          Every one of those decisions is sitting in your{' '}
          <Link className="text-brand-primary underline hover:text-brand-primary-hover" href="/access-log">
            access log
          </Link>
          , not reconstructed after the fact from a chat transcript — and the cross-service token
          exchanges you saw there use a fresh, narrowly-scoped token per hop instead of one shared
          credential, plus Auth0&apos;s Agent as Principal feature to record which real backend
          service actually proxied each request (the <code>act</code> claim), separate from and
          verifiable independently of whatever the assistant&apos;s own delegation state claims.
          Auth0 could have solved &quot;an AI agent needs to act on a user&apos;s behalf&quot; by
          inventing a custom header the backend just trusts — instead it&apos;s a real,
          cryptographically verifiable claim inside a standard OAuth token, which is why none of
          this had to be taken on faith.
        </p>
      </div>

      <p className="mt-6 text-xs text-ink-muted">
        For the technically curious, the actual code — none of what you just read is a
        simplification of what&apos;s really there:
      </p>
      <div className="mt-2 flex gap-4 text-sm">
        <a
          className="inline-flex items-center gap-1 text-brand-primary underline hover:text-brand-primary-hover"
          href="https://github.com/tobyallen/smartgov-app"
          target="_blank"
          rel="noreferrer"
        >
          Repo
          <ExternalIcon />
        </a>
        <a
          className="inline-flex items-center gap-1 text-brand-primary underline hover:text-brand-primary-hover"
          href="https://github.com/tobyallen/smartgov-app/blob/main/fga-model.fga"
          target="_blank"
          rel="noreferrer"
        >
          FGA model
          <ExternalIcon />
        </a>
        <a
          className="inline-flex items-center gap-1 text-brand-primary underline hover:text-brand-primary-hover"
          href="https://github.com/tobyallen/smartgov-app/blob/main/src/app/api/admin-mcp/route.ts"
          target="_blank"
          rel="noreferrer"
        >
          MCP server code
          <ExternalIcon />
        </a>
      </div>
    </main>
  );
}
