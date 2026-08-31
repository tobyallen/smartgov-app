'use client';

import { useEffect, useState } from 'react';

type TokenData = { idToken: string | null; accessToken: string; user: Record<string, unknown> };

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function jwtIoUrl(token: string) {
  return `https://jwt.io/#id_token=${encodeURIComponent(token)}`;
}

function TokenBlock({ label, token }: { label: string; token: string }) {
  const claims = decodeJwtPayload(token);
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <div className="font-medium">{label}</div>
        <a
          href={jwtIoUrl(token)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded bg-gray-700 px-2 py-1 text-xs text-white hover:bg-gray-600"
        >
          View on jwt.io
        </a>
      </div>
      <pre className="mt-1 max-h-40 overflow-auto rounded bg-black/80 p-2 text-[11px] text-green-300">
        {claims ? JSON.stringify(claims, null, 2) : '(could not decode)'}
      </pre>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-gray-400">Raw token</summary>
        <div className="mt-1 break-all rounded bg-black/80 p-2 text-[10px] text-gray-300">{token}</div>
      </details>
    </div>
  );
}

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
    <div className="mt-auto border-t bg-gray-50 text-xs text-gray-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2 text-left font-mono text-gray-500 hover:bg-gray-100"
      >
        {open ? '▾' : '▸'} debug: id/access tokens
      </button>
      {open && (
        <div className="max-w-3xl px-4 pb-4">
          {error && <div className="text-red-600">{error}</div>}
          {!error && !data && <div className="text-gray-500">Loading…</div>}
          {data && (
            <>
              {data.idToken ? (
                <TokenBlock label="ID Token" token={data.idToken} />
              ) : (
                <div className="mt-2 text-gray-500">No ID token in session.</div>
              )}
              <TokenBlock label="Access Token" token={data.accessToken} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
