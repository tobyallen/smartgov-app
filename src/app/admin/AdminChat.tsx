'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import Link from 'next/link';
import OneTimeNote from '@/components/OneTimeNote';
import { chatErrorMessage, isModelContentFilterRefusal, TokenBlock } from '@/components/TokenBlock';
import { ChatMessageText } from '@/components/ChatMessageText';
import { CibaApproval } from '@/components/CibaApproval';
import { ResetMyDataButton } from '@/components/ResetMyDataButton';

type TraceEvent = {
  kind: 'fga_check' | 'obo_exchange';
  label: string;
  allowed?: boolean;
  token?: string;
};

function TraceCard({ event, subjectEmail }: { event: TraceEvent; subjectEmail?: string }) {
  if (event.kind === 'obo_exchange') {
    return (
      <div className="my-1 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        🔁 {event.label}
        {event.token && (
          <TokenBlock label="Exchanged token" token={event.token} subjectEmail={subjectEmail} />
        )}
      </div>
    );
  }
  const ok = event.allowed;
  return (
    <div
      className={`my-1 rounded border px-3 py-2 text-xs ${
        ok ? 'border-green-300 bg-green-50 text-green-900' : 'border-red-300 bg-red-50 text-red-900'
      }`}
    >
      ⚙ FGA check: {event.label} → {ok ? 'ALLOWED' : 'DENIED'}
    </div>
  );
}

export default function AdminChat() {
  const [stepUpPending, setStepUpPending] = useState(false);
  const [stepUpApprovedAt, setStepUpApprovedAt] = useState<string | null>(null);
  const [cibaOpen, setCibaOpen] = useState(false);
  // Bumped on every open so CibaApproval remounts fresh each time
  // (see that component's comment on why it resets state via remount,
  // not an effect).
  const [cibaKey, setCibaKey] = useState(0);
  const [chatError, setChatError] = useState<string | null>(null);
  // See src/app/chat/page.tsx - same one-time email fetch, reused here
  // so trace cards can annotate the caseworker's own sub instead of a
  // bare uid.
  const [subjectEmail, setSubjectEmail] = useState<string | undefined>(undefined);
  useEffect(() => {
    fetch('/api/debug-tokens')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSubjectEmail(data?.email ?? undefined))
      .catch(() => setSubjectEmail(undefined));
  }, []);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/admin-chat' }),
    // Without this, a non-streaming error response (a stale-session 401,
    // or any other pre-stream failure) failed completely silently in the
    // UI - see src/app/chat/page.tsx for the citizen-side version of
    // this same fix.
    onError: (error) => setChatError(chatErrorMessage(error)),
  });

  function send(text: string) {
    setChatError(null);
    sendMessage({ text });
  }

  // Opens the simulated CIBA/mobile-approval modal rather than calling
  // /api/request-step-up directly — the real POST only fires from
  // handleCibaComplete, once the simulated out-of-band approval resolves.
  // See components/CibaApproval.tsx for why this is a simulation, not a
  // real Auth0 CIBA integration.
  function requestStepUp() {
    setCibaKey((k) => k + 1);
    setCibaOpen(true);
  }

  async function handleCibaComplete(approved: boolean) {
    setCibaOpen(false);
    if (!approved) return;

    setStepUpPending(true);
    const res = await fetch('/api/request-step-up', { method: 'POST' });
    if (res.ok) setStepUpApprovedAt(new Date().toLocaleTimeString());
    setStepUpPending(false);
  }

  async function stepDown() {
    setStepUpPending(true);
    const res = await fetch('/api/request-step-up', { method: 'DELETE' });
    if (res.ok) setStepUpApprovedAt(null);
    setStepUpPending(false);
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      {cibaOpen && (
        <CibaApproval
          key={cibaKey}
          onClose={() => setCibaOpen(false)}
          onComplete={handleCibaComplete}
        />
      )}

      {/* No "My case" / "Chat" links here - this page only ever renders for
          a caseworker session (gated server-side in admin/page.tsx), and a
          caseworker persona has neither a case nor a citizen assistant to
          link to. */}
      <div className="mb-4 flex gap-4 text-sm">
        <Link className="text-blue-600 underline" href="/">Home</Link>
        <Link className="text-blue-600 underline" href="/access-log">Access log</Link>
        <Link className="text-blue-600 underline" href="/recap">What you just saw</Link>
        <a className="text-blue-600 underline" href="/auth/logout">Log out</a>
      </div>

      <OneTimeNote step="admin-rbac-explainer-seen">
        <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
          This console is reachable by every visitor - but what you can do here depends on two
          separate checks. Your <strong>role</strong> (citizen vs. caseworker) decides which tools
          even exist for you; a citizen wouldn&apos;t see contractor management tools listed at
          all. <a className="text-blue-600 underline" href="https://auth0.com/docs/secure/fine-grained-authorization">Auth0 FGA</a>{' '}
          then decides, for a caseworker who does have the tools, which specific contractor
          record they can act on, and whether a riskier action needs a fresh approval first.
        </p>
      </OneTimeNote>

      <OneTimeNote step="admin-mcp-explainer-seen">
        <p className="mb-4 text-xs text-gray-500">
          This chatbot is itself an{' '}
          <a className="underline" href="https://modelcontextprotocol.io/">MCP</a> client - the
          same tools you can trigger by typing below are also exposed as a real,
          independently-callable MCP server at <code>/api/admin-mcp</code>.
        </p>
      </OneTimeNote>

      <div className="mb-4 flex items-center justify-between rounded border p-3">
        <div>
          <div className="font-medium">Step-up approval for bulk actions</div>
          <div className="text-xs text-gray-500">
            Simulates a fresh MFA/CIBA challenge — required before bulk_disable_contractors or
            bulk_enable_contractors will succeed, and expires 5 minutes after approval. Clicking
            below opens a simulated out-of-band approval (not a real Auth0 CIBA request) before
            the actual step-up is recorded.
          </div>
          {stepUpApprovedAt && (
            <div className="mt-1 text-xs text-green-700">Approved at {stepUpApprovedAt}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={requestStepUp}
            disabled={stepUpPending}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            {stepUpPending ? '...' : 'Request step-up'}
          </button>
          <button
            onClick={stepDown}
            disabled={stepUpPending || !stepUpApprovedAt}
            className="rounded bg-gray-700 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            Step down
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {messages.map((message) => {
          const traceEvents = (message.metadata as { traceEvents?: TraceEvent[] } | undefined)
            ?.traceEvents;
          const text = message.parts
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('');
          // See isModelContentFilterRefusal in TokenBlock.tsx - this is
          // model flakiness on benign phrasing, not a real answer, so it's
          // rendered as a retry prompt rather than a normal reply bubble.
          const isRefusal = message.role === 'assistant' && isModelContentFilterRefusal(text);
          return (
            <div key={message.id}>
              {traceEvents?.map((event, i) => (
                <TraceCard key={i} event={event} subjectEmail={subjectEmail} />
              ))}
              {isRefusal ? (
                <div className="my-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  The model refused this request for reasons unrelated to your actual
                  permissions — this looks like a false positive on the wording, not a real
                  policy issue. Try rephrasing, or use the golden-path buttons below instead of
                  free-form text.
                </div>
              ) : (
                <div className={message.role === 'user' ? 'text-right' : ''}>
                  <div
                    className={`inline-block rounded px-3 py-2 text-sm ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                    }`}
                  >
                    {message.parts.map((part, i) =>
                      part.type === 'text' ? <ChatMessageText key={i} text={part.text} /> : null,
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <button
          onClick={() => send('List all contractors')}
          disabled={status !== 'ready'}
          className="rounded border border-blue-600 px-3 py-1 text-blue-600 disabled:opacity-40 dark:text-blue-400"
        >
          List contractors
        </button>
        <button
          onClick={() => send('Disable contractor-1')}
          disabled={status !== 'ready'}
          className="rounded border border-blue-600 px-3 py-1 text-blue-600 disabled:opacity-40 dark:text-blue-400"
        >
          Disable a contractor
        </button>
        <button
          onClick={() => send('Enable contractor-1')}
          disabled={status !== 'ready'}
          className="rounded border border-blue-600 px-3 py-1 text-blue-600 disabled:opacity-40 dark:text-blue-400"
        >
          Enable a contractor
        </button>
        <button
          onClick={() => send('Bulk disable contractor-2, contractor-3, and contractor-4')}
          disabled={status !== 'ready'}
          className="rounded border border-blue-600 px-3 py-1 text-blue-600 disabled:opacity-40 dark:text-blue-400"
        >
          Try a bulk action
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        &quot;Try a bulk action&quot; is denied on purpose until you request step-up above -
        that&apos;s the gate this vignette is demonstrating.
      </p>

      {chatError && (
        <div className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {chatError}
        </div>
      )}

      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem('message') as HTMLInputElement;
          if (input.value.trim()) {
            send(input.value);
            input.value = '';
          }
        }}
      >
        <input
          name="message"
          className="flex-1 rounded border px-3 py-2"
          placeholder="Ask about contractors..."
        />
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white" disabled={status !== 'ready'}>
          Send
        </button>
      </form>

      <div className="mt-6 border-t pt-4">
        <ResetMyDataButton persona="caseworker" />
      </div>
    </main>
  );
}
