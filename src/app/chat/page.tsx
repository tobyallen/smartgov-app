'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import Link from 'next/link';
import OneTimeNote from '@/components/OneTimeNote';

type TraceEvent = { kind: 'fga_check' | 'obo_exchange'; label: string; allowed?: boolean };

function TraceCard({ event }: { event: TraceEvent }) {
  if (event.kind === 'obo_exchange') {
    return (
      <div className="my-1 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        🔁 {event.label}
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

export default function ChatPage() {
  const [delegated, setDelegated] = useState(false);
  const [togglePending, setTogglePending] = useState(false);
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    onFinish: () => refreshDelegation(),
  });

  function refreshDelegation() {
    return fetch('/api/delegation')
      .then((r) => r.json())
      .then((data) => setDelegated(Boolean(data.granted)));
  }

  useEffect(() => {
    refreshDelegation();
  }, []);

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
          time, and the very next request will reflect it immediately.
        </p>
      </OneTimeNote>

      <div className="mb-4 flex items-center justify-between rounded border p-3">
        <div>
          <div className="font-medium">Allow my AI assistant to access this case</div>
          <div className="text-xs text-gray-500">
            You can always see your own case — this only controls what your assistant can see.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => !delegated && toggleDelegation()}
            disabled={togglePending || status !== 'ready' || delegated}
            className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            Grant delegation
          </button>
          <button
            onClick={() => delegated && toggleDelegation()}
            disabled={togglePending || status !== 'ready' || !delegated}
            className="rounded bg-gray-700 px-3 py-1 text-sm text-white disabled:opacity-40"
          >
            Revoke delegation
          </button>
          <span
            className={`rounded px-3 py-1 text-sm ${delegated ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}
          >
            {togglePending ? '...' : delegated ? 'Delegated' : 'Not delegated'}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {messages.map((message) => {
          const traceEvents = (message.metadata as { traceEvents?: TraceEvent[] } | undefined)
            ?.traceEvents;
          return (
            <div key={message.id}>
              {traceEvents?.map((event, i) => <TraceCard key={i} event={event} />)}
              <div className={message.role === 'user' ? 'text-right' : ''}>
                <div
                  className={`inline-block rounded px-3 py-2 text-sm ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                  }`}
                >
                  {message.parts.map((part, i) =>
                    part.type === 'text' ? <span key={i}>{part.text}</span> : null,
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => sendMessage({ text: 'Ask for my case summary' })}
        disabled={status !== 'ready'}
        className="mt-4 rounded border border-blue-600 px-3 py-1 text-sm text-blue-600 disabled:opacity-40 dark:text-blue-400"
      >
        Ask for my case summary
      </button>

      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem('message') as HTMLInputElement;
          if (input.value.trim()) {
            sendMessage({ text: input.value });
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
