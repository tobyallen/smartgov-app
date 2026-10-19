'use client';

import { useState } from 'react';
import { CLIENT_DISPLAY_NAMES } from '@/lib/serviceNames';

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

// Every "user" sub shown anywhere in this app's tokens is always the
// current viewer's own uid - there's no page where a citizen's trace
// cards ever show a DIFFERENT citizen's tokens. So a single optional
// email (not a map) is enough: pass the viewer's own, and any sub that
// matches it gets annotated the same way a known client ID does.
function subjectLabel(sub: string, subjectId?: string, subjectEmail?: string): string {
  if (subjectEmail && sub === subjectId) return subjectEmail;
  return CLIENT_DISPLAY_NAMES[sub] ?? sub;
}

type ActClaim = { sub: string; sub_profile?: string; act?: ActClaim };
type Hop = { id: string; isAgent: boolean };

// The `act` claim nests once per OBO exchange, outermost = most recent.
// Flattening it into an ordered array (oldest hop first) is what makes
// it renderable as a left-to-right chain instead of a JSON tree the
// reader has to mentally invert. sub_profile: 'ai_agent' (set once
// agent_subject_claims: 'auth0-v1' is enabled - see mcpAuth.ts) is what
// lets the chain badge a real registered Auth0 agent identity
// differently from an ordinary client/app hop.
function flattenActChain(act: ActClaim | undefined): Hop[] {
  const chain: Hop[] = [];
  let current = act;
  while (current) {
    chain.unshift({ id: current.sub, isAgent: current.sub_profile === 'ai_agent' });
    current = current.act;
  }
  return chain;
}

// The citizen (`sub`) is the first box, not a caption beside the chain -
// every later hop is an app acting on their behalf, so starting the
// chain at the person being acted for reads left-to-right as "who this
// is about, then who's carried it, then where it ends up," rather than
// requiring a separate sentence to say the same thing.
function TokenHopChain({
  claims,
  subjectEmail,
}: {
  claims: Record<string, unknown>;
  subjectEmail?: string;
}) {
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  const aud = typeof claims.aud === 'string' ? claims.aud : undefined;
  const act = claims.act as ActClaim | undefined;
  if (!sub) return null;

  // Citizen first, then oldest-to-newest app hop, ending at this
  // token's own destination.
  const hops: Hop[] = [
    { id: sub, isAgent: false },
    ...flattenActChain(act),
    { id: aud ?? 'this API', isAgent: false },
  ];

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      {hops.map((hop, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-ink-muted">→</span>}
          <span
            className={
              i === 0
                ? 'rounded bg-emerald-700 px-1.5 py-0.5 text-white'
                : i === hops.length - 1
                  ? 'rounded bg-blue-700 px-1.5 py-0.5 text-white'
                  : hop.isAgent
                    ? 'rounded bg-purple-700 px-1.5 py-0.5 text-white'
                    : 'rounded bg-gray-700 px-1.5 py-0.5 text-white'
            }
          >
            {hop.isAgent && <span className="mr-1 text-[9px] uppercase tracking-wide text-purple-200">agent</span>}
            {i === hops.length - 1 ? hop.id : subjectLabel(hop.id, sub, subjectEmail)}
          </span>
        </span>
      ))}
    </div>
  );
}

// Renders the same JSON as JSON.stringify would, line by line, but
// appends a friendly-name badge to any line whose value is a known
// client ID or the current viewer's own subject - so
// "sub": "xCMSFekvf2fsIFVFqPPz7RkkaE4UyFV0" reads alongside "SmartGov
// Chatbot Backend (v2)", and "sub": "auth0|..." reads alongside
// "citizen@atko.email", instead of requiring the reader to
// cross-reference the hop-chain diagram above by eye.
function AnnotatedClaimsJson({
  claims,
  subjectEmail,
}: {
  claims: Record<string, unknown>;
  subjectEmail?: string;
}) {
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  const json = JSON.stringify(claims, null, 2);
  const lines = json.split('\n');
  const knownIds = sub && subjectEmail ? { ...CLIENT_DISPLAY_NAMES, [sub]: subjectEmail } : CLIENT_DISPLAY_NAMES;
  return (
    <>
      {lines.map((line, i) => {
        const match = Object.keys(knownIds).find((id) => line.includes(id));
        return (
          <div key={i} className="flex flex-wrap items-start gap-1">
            <span>{line}</span>
            {match && (
              <span className="rounded bg-ink-secondary px-1.5 py-0.5 text-[10px] text-white">
                {knownIds[match]}
              </span>
            )}
          </div>
        );
      })}
    </>
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

// Amazon Nova Pro (via the AI Gateway/Bedrock) occasionally refuses an
// entirely benign request - confirmed live on "bulk disable
// contractor-2, contractor-3, and contractor-4," the app's own golden-path
// button text - with this exact literal string as its "answer," not as a
// thrown error or a distinct finishReason the AI SDK exposes. streamText
// has no way to tell this apart from a real answer; it's normal assistant
// text as far as the SDK is concerned. Checked here, client-side, once a
// message is complete, purely so the chat UI can render it as a retry
// prompt instead of a normal reply - this is model flakiness on ambiguous
// phrasing, not a real policy violation or an app bug, so the fix is
// presentation, not authorization or backend logic.
const MODEL_CONTENT_FILTER_REFUSAL = 'blocked by our content filters';

export function isModelContentFilterRefusal(text: string): boolean {
  return text.toLowerCase().includes(MODEL_CONTENT_FILTER_REFUSAL);
}

export function TokenBlock({
  label,
  token,
  subjectEmail,
}: {
  label: string;
  token: string;
  // The current viewer's own email, matched against any `sub` in this
  // token that equals the token's top-level subject - see subjectLabel
  // above. Optional because callers that haven't fetched it yet (or a
  // token belonging to a page with no session, in principle) still get
  // the bare uid rather than the annotation breaking.
  subjectEmail?: string;
}) {
  const claims = decodeJwtPayload(token);
  // Collapsed by default (matches the previous fixed-height behaviour) -
  // expanded removes the max-height/scroll clamp so the full decoded
  // payload (e.g. a nested act chain several hops deep) is visible
  // without needing to scroll a tiny fixed box.
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-medium text-ink-primary">{label}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded bg-ink-secondary px-2 py-1 text-xs text-white hover:bg-ink-primary"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
          <a
            href={jwtIoUrl(token)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-ink-secondary px-2 py-1 text-xs text-white hover:bg-ink-primary"
          >
            View on jwt.io
          </a>
        </div>
      </div>
      {claims && <TokenHopChain claims={claims} subjectEmail={subjectEmail} />}
      <pre
        className={
          expanded
            ? 'mt-1 overflow-auto whitespace-pre-wrap break-all rounded bg-black p-2 text-[11px] text-status-good'
            : 'mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black p-2 text-[11px] text-status-good'
        }
      >
        {claims ? <AnnotatedClaimsJson claims={claims} subjectEmail={subjectEmail} /> : '(could not decode)'}
      </pre>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-ink-muted">Raw token</summary>
        <div className="mt-1 break-all rounded bg-black p-2 text-[10px] text-ink-muted">{token}</div>
      </details>
    </div>
  );
}
