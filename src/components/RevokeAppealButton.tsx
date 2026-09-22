'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Citizen-direct, not a chat tool: revoking a submitted appeal checks the
// plain `owner` relation server-side (see checkOwner in lib/fga.ts),
// deliberately never delegated to the assistant the way submit_appeal is.
// Lives on the case page rather than the chat page for the same reason -
// this is a fact and an action about the case record itself, not a chat
// turn, so it sits next to the status it changes rather than among the
// chat page's golden-path send buttons (where an earlier version of this
// lived, and read as though it were a chat request).
export function RevokeAppealButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function revokeAppeal() {
    setPending(true);
    setMessage(null);
    const res = await fetch('/api/revoke-appeal', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      // Server component - re-fetch this page's data so Status updates
      // from 'appeal_submitted' back to 'open' without a full reload.
      router.refresh();
    } else {
      setMessage(body.error ?? 'Could not revoke the appeal.');
    }
    setPending(false);
  }

  return (
    <div className="mt-2">
      <button
        onClick={revokeAppeal}
        disabled={pending}
        className="rounded border border-ink-secondary px-3 py-1 text-sm text-ink-secondary disabled:opacity-40"
      >
        {pending ? '...' : 'Revoke appeal'}
      </button>
      <p className="mt-1 text-xs text-ink-muted">
        Revoking is something only you can do directly - your assistant can&apos;t revoke an
        appeal on your behalf, even with delegation granted.
      </p>
      {message && (
        <div className="mt-2 rounded border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">
          {message}
        </div>
      )}
    </div>
  );
}
