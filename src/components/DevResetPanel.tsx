'use client';

import { useState } from 'react';

// dev-tools-only client of POST /api/dev/reset's privileged paths -
// targetUserId (reset a different account, for rehearsal) and
// resetContractors (clear every caseworker's contractor grants and
// reseed the mock records). Both fields are only ever honoured
// server-side for a caller who already holds the dev-tools role (see
// route.ts) - this component being reachable doesn't grant anything by
// itself, it's just a form around a route that re-checks the role on
// every request.
export function DevResetPanel() {
  const [targetUserId, setTargetUserId] = useState('');
  const [resetContractors, setResetContractors] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setResult(null);
    const res = await fetch('/api/dev/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(targetUserId.trim() ? { targetUserId: targetUserId.trim() } : {}),
        ...(resetContractors ? { resetContractors: true } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.reset) {
      setResult(`Reset OK for ${body.targetUserId}${resetContractors ? ' (contractors also reset)' : ''}.`);
    } else if (res.status === 207) {
      setResult(`Partially failed: ${JSON.stringify(body)}`);
    } else {
      setResult(body.error ?? `HTTP ${res.status}`);
    }
    setPending(false);
  }

  return (
    <div className="mt-4 space-y-3 rounded border border-status-warning/40 bg-status-warning/10 p-4 text-sm">
      <div>
        <label className="block text-xs font-medium text-ink-secondary" htmlFor="targetUserId">
          Target user ID (Auth0 sub) — leave blank to reset your own account
        </label>
        <input
          id="targetUserId"
          type="text"
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
          placeholder="auth0|..."
          className="mt-1 w-full rounded border border-surface-hairline px-2 py-1 text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-secondary">
        <input
          type="checkbox"
          checked={resetContractors}
          onChange={(e) => setResetContractors(e.target.checked)}
        />
        Also reset contractor grants + reseed contractor records (affects every caseworker)
      </label>
      <button
        onClick={submit}
        disabled={pending}
        className="rounded border border-status-warning px-3 py-1 text-sm font-medium text-ink-primary disabled:opacity-40"
      >
        {pending ? '...' : 'Run reset'}
      </button>
      {result && <p className="text-xs text-ink-secondary">{result}</p>}
    </div>
  );
}
