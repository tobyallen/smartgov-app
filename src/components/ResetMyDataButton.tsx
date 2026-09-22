'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearAllSeenSteps } from '@/lib/walkthroughSteps';

// Own-data-only client of POST /api/dev/reset - never sends targetUserId
// or resetContractors, so this button always hits the route's safe,
// self-scoped path regardless of who's signed in (see route.ts's own
// comment on why that path needs no role gate). Visible to every
// visitor, not just dev-tools holders - "replay the walkthrough fresh"
// per the build plan's "Reruns" section is a self-service feature, not
// a privileged one.
//
// Rendered on both /case (citizen) and /admin (caseworker) - added to
// /admin after a real question ("a caseworker doesn't have access to
// the case page, how would they reset their usage") surfaced that
// caseworkers had no reachable reset action at all. The route's actual
// behaviour is identical either way (clear whatever's keyed to this
// uid), but what that amounts to differs by persona - a caseworker has
// no case/agent/delegation state to begin with, only audit events from
// their own admin actions - so the copy is parameterised rather than
// left citizen-flavoured on both pages.
export function ResetMyDataButton({ persona = 'citizen' }: { persona?: 'citizen' | 'caseworker' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const confirmText =
    persona === 'caseworker'
      ? 'This deletes your access log entries (case-related step-up/bulk-action history). Continue?'
      : 'This deletes your case, agent delegation, and access log. You can sign up fresh or just revisit /case to re-provision. Continue?';
  const description =
    persona === 'caseworker'
      ? "Clears your own access log entries on this account, so a rehearsal run doesn't mix into a later one."
      : 'Clears your case, delegation, and access log so you can replay the walkthrough from scratch on this same account.';

  async function resetMyData() {
    if (!window.confirm(confirmText)) {
      return;
    }
    setPending(true);
    setMessage(null);
    const res = await fetch('/api/dev/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.reset) {
      clearAllSeenSteps();
      router.refresh();
    } else {
      const failed = body?.citizen?.failed as string[] | undefined;
      setMessage(
        failed?.length
          ? `Reset partially failed (${failed.join(', ')}) - some state may still be cleared. Try again.`
          : (body.error ?? 'Could not reset your data.'),
      );
    }
    setPending(false);
  }

  return (
    <div className="mt-2">
      <button
        onClick={resetMyData}
        disabled={pending}
        className="rounded border border-gray-500 px-3 py-1 text-sm text-gray-700 disabled:opacity-40 dark:text-gray-300"
      >
        {pending ? '...' : 'Reset my data'}
      </button>
      <p className="mt-1 text-xs text-gray-500">{description}</p>
      {message && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {message}
        </div>
      )}
    </div>
  );
}
