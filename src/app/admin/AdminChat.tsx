'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import Link from 'next/link';

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

export default function AdminChat() {
  const [stepUpPending, setStepUpPending] = useState(false);
  const [stepUpApprovedAt, setStepUpApprovedAt] = useState<string | null>(null);
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/admin-chat' }),
  });

  async function requestStepUp() {
    setStepUpPending(true);
    const res = await fetch('/api/request-step-up', { method: 'POST' });
    if (res.ok) setStepUpApprovedAt(new Date().toLocaleTimeString());
    setStepUpPending(false);
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex gap-4 text-sm">
        <Link className="text-blue-600 underline" href="/">Home</Link>
        <Link className="text-blue-600 underline" href="/case">My case</Link>
        <Link className="text-blue-600 underline" href="/chat">Chat</Link>
        <Link className="text-blue-600 underline" href="/access-log">Access log</Link>
        <Link className="text-blue-600 underline" href="/recap">What you just saw</Link>
        <a className="text-blue-600 underline" href="/auth/logout">Log out</a>
      </div>

      <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
        This console is reachable by every visitor - but what you can do here depends on two
        separate checks. Your <strong>role</strong> (citizen vs. caseworker) decides which tools
        even exist for you; a citizen wouldn&apos;t see contractor management tools listed at
        all. <a className="text-blue-600 underline" href="https://auth0.com/docs/secure/fine-grained-authorization">Auth0 FGA</a>{' '}
        then decides, for a caseworker who does have the tools, which specific contractor record
        they can act on, and whether a riskier action needs a fresh approval first.
      </p>

      <p className="mb-4 text-xs text-gray-500">
        This chatbot is itself an{' '}
        <a className="underline" href="https://modelcontextprotocol.io/">MCP</a> client - the
        same tools you can trigger by typing below are also exposed as a real,
        independently-callable MCP server at <code>/api/admin-mcp</code>.
      </p>

      <div className="mb-4 flex items-center justify-between rounded border p-3">
        <div>
          <div className="font-medium">Step-up approval for bulk actions</div>
          <div className="text-xs text-gray-500">
            Simulates a fresh MFA/CIBA challenge — required before bulk_disable_contractors
            will succeed, and expires 5 minutes after approval.
          </div>
          {stepUpApprovedAt && (
            <div className="mt-1 text-xs text-green-700">Approved at {stepUpApprovedAt}</div>
          )}
        </div>
        <button
          onClick={requestStepUp}
          disabled={stepUpPending}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
        >
          {stepUpPending ? '...' : 'Request step-up'}
        </button>
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

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <button
          onClick={() => sendMessage({ text: 'List all contractors' })}
          disabled={status !== 'ready'}
          className="rounded border border-blue-600 px-3 py-1 text-blue-600 disabled:opacity-40 dark:text-blue-400"
        >
          List contractors
        </button>
        <button
          onClick={() => sendMessage({ text: 'Disable contractor-1' })}
          disabled={status !== 'ready'}
          className="rounded border border-blue-600 px-3 py-1 text-blue-600 disabled:opacity-40 dark:text-blue-400"
        >
          Disable a contractor
        </button>
        <button
          onClick={() =>
            sendMessage({ text: 'Bulk disable contractor-2, contractor-3, and contractor-4' })
          }
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
        <input
          name="message"
          className="flex-1 rounded border px-3 py-2"
          placeholder="Ask about contractors..."
        />
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white" disabled={status !== 'ready'}>
          Send
        </button>
      </form>
    </main>
  );
}
