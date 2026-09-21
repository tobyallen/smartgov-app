'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import Link from 'next/link';
import OneTimeNote from '@/components/OneTimeNote';
import { chatErrorMessage, isModelContentFilterRefusal, TokenBlock } from '@/components/TokenBlock';
import { ChatMessageText } from '@/components/ChatMessageText';

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

// Mirrors the FGA model's delegation_window duration (fga-model.fga) -
// purely cosmetic here, the actual expiry is enforced server-side on
// every check regardless of what this constant says.
const DELEGATION_WINDOW_MINUTES = 15;

export default function ChatPage() {
  const [delegated, setDelegated] = useState(false);
  const [delegationGrantedAt, setDelegationGrantedAt] = useState<string | null>(null);
  const [minutesRemaining, setMinutesRemaining] = useState<number | null>(null);
  const [togglePending, setTogglePending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  // Fetched once so trace cards can annotate the citizen's own sub with
  // "citizen@atko.email" instead of a bare auth0|... uid - the same
  // email /api/debug-tokens already exposes for the DebugTokens footer,
  // reused here rather than adding a second endpoint for the same value.
  const [subjectEmail, setSubjectEmail] = useState<string | undefined>(undefined);
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    onFinish: () => refreshDelegation(),
    // Without this, a non-streaming error response (a stale-session 401,
    // or any other pre-stream failure) failed completely silently in the
    // UI - the request shows up in the network tab and nowhere else,
    // exactly what prompted this fix.
    onError: (error) => setChatError(chatErrorMessage(error)),
  });

  function refreshDelegation() {
    return fetch('/api/delegation')
      .then((r) => r.json())
      .then((data) => {
        setDelegated(Boolean(data.granted));
        setDelegationGrantedAt(data.delegationGrantedAt ?? null);
      });
  }

  // Clears any previous error before a new attempt, so a fixed problem
  // (e.g. logging back in after the "session expired" message) doesn't
  // leave a stale error banner sitting above a message that actually worked.
  function send(text: string) {
    setChatError(null);
    sendMessage({ text });
  }

  useEffect(() => {
    refreshDelegation();
    // Delegation can expire purely from time passing, with no click of
    // any kind - a periodic refetch is what makes that visible without
    // needing a chat turn or a page reload to notice.
    const interval = setInterval(refreshDelegation, 15_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch('/api/debug-tokens')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSubjectEmail(data?.email ?? undefined))
      .catch(() => setSubjectEmail(undefined));
  }, []);

  // Date.now() is impure, so it can't be called during render (React
  // flags this) - recompute the countdown in an effect, ticking every
  // 30s, rather than deriving it inline from the current render's clock.
  useEffect(() => {
    function tick() {
      if (!delegationGrantedAt) {
        setMinutesRemaining(null);
        return;
      }
      const elapsedMinutes = Math.floor((Date.now() - new Date(delegationGrantedAt).getTime()) / 60_000);
      setMinutesRemaining(Math.max(0, DELEGATION_WINDOW_MINUTES - elapsedMinutes));
    }
    tick();
    const interval = setInterval(tick, 30_000);
    return () => clearInterval(interval);
  }, [delegationGrantedAt]);

  async function toggleDelegation() {
    setTogglePending(true);
    const next = !delegated;
    const res = await fetch('/api/delegation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ granted: next }),
    });
    // Re-read actual server/FGA state rather than trusting the request we
    // just sent succeeded — a prior bug had this button show "Delegated"
    // purely from optimistic local state while a real check on the same
    // tuple came back denied, because nothing ever reconciled the two.
    if (res.ok) await refreshDelegation();
    setTogglePending(false);
  }

  // Debug-only: forces the delegation_window condition to fail on the
  // next check without touching the FGA tuple - see expireDelegationNow
  // in lib/fga.ts. Not part of the citizen-facing story; a presenter's
  // reliability escape hatch for demoing expiry on cue.
  async function debugExpireNow() {
    setTogglePending(true);
    const res = await fetch('/api/delegation', { method: 'DELETE' });
    if (res.ok) await refreshDelegation();
    setTogglePending(false);
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex gap-4 text-sm">
        <Link className="text-blue-600 underline" href="/">Home</Link>
        <Link className="text-blue-600 underline" href="/case">My case</Link>
        <Link className="text-blue-600 underline" href="/access-log">Access log</Link>
        <a className="text-blue-600 underline" href="/auth/logout">Log out</a>
      </div>

      <OneTimeNote step="chat-delegation-explainer-seen">
        <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
          Your assistant doesn&apos;t automatically inherit your access to your own data -
          it&apos;s a separate identity, and until you grant it a scoped permission below, every
          request it makes on your behalf will be denied. You can revoke that permission at any
          time, and the very next request will reflect it immediately - or just wait: delegation
          expires on its own after {DELEGATION_WINDOW_MINUTES} minutes, checked fresh every time,
          not something you have to remember to turn off.
        </p>
      </OneTimeNote>

      <div className="mb-4 flex items-center justify-between rounded border p-3">
        <div>
          <div className="font-medium">Allow my AI assistant to access this case</div>
          <div className="text-xs text-gray-500">
            You can always see your own case — this only controls what your assistant can see.
            {delegated && minutesRemaining !== null && (
              <span className="ml-1">
                {minutesRemaining > 0
                  ? `Expires in ${minutesRemaining} min unless revoked first.`
                  : 'Expiring now — the next check will deny it.'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => !delegated && toggleDelegation()}
            disabled={togglePending || status !== 'ready' || delegated}
            className="w-36 rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            Grant delegation
          </button>
          <button
            onClick={() => delegated && toggleDelegation()}
            disabled={togglePending || status !== 'ready' || !delegated}
            className="w-36 rounded bg-gray-700 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            Revoke delegation
          </button>
          <span
            className={`w-36 rounded px-3 py-1 text-center text-sm ${delegated ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}
          >
            {/* Fixed label per state, not the transient "..." - the
            box's own width (matching the two buttons above) is what
            already communicates "in flight," so it doesn't also need
            to change size or text mid-request. */}
            {delegated ? 'Delegated' : 'Not delegated'}
          </span>
        </div>
      </div>

      {delegated && (
        <div className="mb-4 flex items-center justify-between rounded border border-dashed p-2 text-xs text-gray-500">
          <span>
            <strong>Presenter tool, not part of the citizen flow:</strong> fast-forwards the clock
            on the same grant above, so you can show the 15-minute window lapsing on its own
            without waiting 15 minutes. Unlike Revoke, the delegation tuple itself is untouched -
            only its time runs out.
          </span>
          <button
            onClick={debugExpireNow}
            disabled={togglePending || status !== 'ready'}
            className="ml-2 shrink-0 rounded border border-gray-400 px-2 py-1 text-gray-700 disabled:opacity-40 dark:text-gray-300"
          >
            Fast-forward to expiry
          </button>
        </div>
      )}

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
                  policy issue. Try rephrasing, or use the buttons below instead of free-form
                  text.
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

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => send('Ask for my case summary')}
          disabled={status !== 'ready'}
          className="rounded border border-blue-600 px-3 py-1 text-sm text-blue-600 disabled:opacity-40 dark:text-blue-400"
        >
          Ask for my case summary
        </button>
        <button
          onClick={() => send('Submit an appeal for my case')}
          disabled={status !== 'ready'}
          className="rounded border border-blue-600 px-3 py-1 text-sm text-blue-600 disabled:opacity-40 dark:text-blue-400"
        >
          Submit an appeal
        </button>
      </div>

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
        <input name="message" className="flex-1 rounded border px-3 py-2" placeholder="Ask about your case..." />
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white" disabled={status !== 'ready'}>
          Send
        </button>
      </form>
    </main>
  );
}
