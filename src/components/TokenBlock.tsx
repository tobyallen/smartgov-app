'use client';

// Shared by DebugTokens (the citizen's own session tokens) and the chat
// trace cards (the OBO-exchanged tokens minted per-request in lib/obo.ts)
// - same decode/display/jwt.io-link logic either way, only the source of
// the raw JWT string differs.

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function jwtIoUrl(token: string) {
  return `https://jwt.io/#id_token=${encodeURIComponent(token)}`;
}

// Shared by both chat pages' useChat onError handlers. The transport
// throws `new Error(await response.text())` for any non-2xx response
// (see @ai-sdk 'ai' package's HttpChatTransport) - our own API routes
// return a JSON body ({ error: "..." }), so unwrap that shape and fall
// back to the raw text for anything else (a network failure, or a route
// that doesn't return JSON).
export function chatErrorMessage(error: Error): string {
  try {
    const parsed = JSON.parse(error.message);
    if (parsed && typeof parsed.error === 'string') return parsed.error;
  } catch {
    // not JSON - fall through
  }
  return error.message || 'Something went wrong reaching the chat backend.';
}

export function TokenBlock({ label, token }: { label: string; token: string }) {
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
