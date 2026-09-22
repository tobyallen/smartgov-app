'use client';

import { useEffect, useState } from 'react';
import { TokenBlock } from '@/components/TokenBlock';

type TokenData = {
  idToken: string | null;
  accessToken: string;
  user: Record<string, unknown>;
  email: string | null;
};

// Fetches this session's own raw tokens on demand (never on mount, to
// avoid pulling tokens into the page for every visitor who never opens
// this panel) — rendered from the root layout, so it's on every page
// without every page needing to wire it up itself.
export default function DebugTokens() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TokenData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data) return;
    fetch('/api/debug-tokens')
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 401 ? 'Not signed in' : `HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [open, data]);

  return (
    <div className="mt-auto border-t border-surface-hairline bg-ink-secondary/5 text-xs text-ink-secondary">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2 text-left font-mono text-ink-muted hover:bg-ink-secondary/10"
      >
        {open ? '▾' : '▸'} debug: id/access tokens
      </button>
      {open && (
        <div className="max-w-3xl px-4 pb-4">
          {error && <div className="text-status-critical">{error}</div>}
          {!error && !data && <div className="text-ink-muted">Loading…</div>}
          {data && (
            <>
              {data.idToken ? (
                <TokenBlock label="ID Token" token={data.idToken} subjectEmail={data.email ?? undefined} />
              ) : (
                <div className="mt-2 text-ink-muted">No ID token in session.</div>
              )}
              <TokenBlock
                label="Access Token"
                token={data.accessToken}
                subjectEmail={data.email ?? undefined}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
