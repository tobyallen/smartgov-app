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

// Client IDs aren't secrets (only their secrets are), so a hardcoded
// display map is fine here - this only exists to make the `act` chain
// readable as "which app did this hop" instead of a bare opaque ID.
// Falls back to the raw ID for anything not in this tenant's known set,
// rather than hiding an unrecognised hop.
const CLIENT_DISPLAY_NAMES: Record<string, string> = {
  zS9EnPkBdrI0QXfQ73XKMKr7oCnKRNj0: 'SmartGov Citizen Portal',
  xCMSFekvf2fsIFVFqPPz7RkkaE4UyFV0: 'SmartGov Chatbot Backend (v2)',
  pk8ytDLT2CtIoxrFFQqKXaUrRdZs2q94: 'SmartGov Chatbot Backend (case-service hop)',
};

function clientLabel(clientId: string): string {
  return CLIENT_DISPLAY_NAMES[clientId] ?? clientId;
}

type ActClaim = { sub: string; act?: ActClaim };

// The `act` claim nests once per OBO exchange, outermost = most recent.
// Flattening it into an ordered array (oldest hop first) is what makes
// it renderable as a left-to-right chain instead of a JSON tree the
// reader has to mentally invert.
function flattenActChain(act: ActClaim | undefined): string[] {
  const chain: string[] = [];
  let current = act;
  while (current) {
    chain.unshift(current.sub);
    current = current.act;
  }
  return chain;
}

// `sub` names the citizen and never changes across a chain of OBO
// exchanges - it's not another hop, it's the identity every hop in the
// `act` chain is acting FOR. Rendering it as a persistent label beside
// the chain, rather than as a final link in the same row, is what makes
// that distinction visible instead of implying the citizen is just
// another party the token passed through.
function TokenHopChain({ claims }: { claims: Record<string, unknown> }) {
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  const aud = typeof claims.aud === 'string' ? claims.aud : undefined;
  const act = claims.act as ActClaim | undefined;
  if (!sub) return null;

  // Oldest hop first: where the citizen actually logged in, through
  // however many exchanges, ending at this token's own destination.
  const hops = [...flattenActChain(act), aud ?? 'this API'];

  return (
    <div className="mt-1 space-y-1 text-[11px]">
      <div className="flex flex-wrap items-center gap-1">
        {hops.map((id, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-400">→</span>}
            <span
              className={
                i === hops.length - 1
                  ? 'rounded bg-blue-700 px-1.5 py-0.5 text-white'
                  : 'rounded bg-gray-700 px-1.5 py-0.5 text-white'
              }
            >
              {i === hops.length - 1 ? id : clientLabel(id)}
            </span>
          </span>
        ))}
      </div>
      <div className="text-gray-500">
        Acting for <span className="text-gray-300">{sub}</span> at every hop - the subject never
        changes, only who&apos;s currently holding the token does.
      </div>
    </div>
  );
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
      {claims && <TokenHopChain claims={claims} />}
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
