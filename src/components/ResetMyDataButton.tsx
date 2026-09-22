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
export function ResetMyDataButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function resetMyData() {
    if (!window.confirm('This deletes your case, agent delegation, and access log. You can sign up fresh or just revisit /case to re-provision. Continue?')) {
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
      <p className="mt-1 text-xs text-gray-500">
        Clears your case, delegation, and access log so you can replay the walkthrough from
        scratch on this same account.
      </p>
      {message && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {message}
        </div>
      )}
    </div>
  );
}
