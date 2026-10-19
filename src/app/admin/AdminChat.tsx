'use client';

import { useEffect, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import OneTimeNote from '@/components/OneTimeNote';
import { chatErrorMessage, isModelContentFilterRefusal, TokenBlock } from '@/components/TokenBlock';
import { ChatMessageText } from '@/components/ChatMessageText';
import { CibaApproval } from '@/components/CibaApproval';
import { ResetMyDataButton } from '@/components/ResetMyDataButton';
import { AppNav } from '@/components/AppNav';

type TraceEvent = {
  kind: 'fga_check' | 'obo_exchange';
  label: string;
  allowed?: boolean;
  token?: string;
};

function TraceCard({ event, subjectEmail }: { event: TraceEvent; subjectEmail?: string }) {
  if (event.kind === 'obo_exchange') {
    return (
      <div className="my-1 rounded border border-brand-primary/30 bg-brand-primary/10 px-3 py-2 text-xs text-ink-primary">
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
        ok ? 'border-status-good/40 bg-status-good/10 text-ink-primary' : 'border-status-critical/40 bg-status-critical/10 text-ink-primary'
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
      <AppNav
        links={[
          { label: 'Home', href: '/' },
          { label: 'Access log', href: '/access-log' },
          { label: 'What you just saw', href: '/recap' },
          { label: 'Log out', href: '/auth/logout', role: 'destructive' },
        ]}
      />

      <OneTimeNote step="admin-rbac-explainer-seen">
        <p className="mb-3 text-sm text-ink-secondary">
          This console is reachable by every visitor - but what you can do here depends on two
          separate checks. Your <strong>role</strong> (citizen vs. caseworker) decides which tools
          even exist for you; a citizen wouldn&apos;t see contractor management tools listed at
          all.{' '}
          <a
            className="text-brand-primary underline hover:text-brand-primary-hover inline-flex items-center gap-1"
            href="https://auth0.com/docs/secure/fine-grained-authorization"
            target="_blank"
            rel="noreferrer"
          >
            Auth0 FGA
          </a>{' '}
          (opens Auth0&apos;s own docs on the ReBAC model behind this) then decides, for a
          caseworker who does have the tools, which specific contractor record they can act on,
          and whether a riskier action needs a fresh approval first.
        </p>
      </OneTimeNote>

      <OneTimeNote step="admin-mcp-explainer-seen">
        <p className="mb-4 text-xs text-ink-muted">
          This chatbot is itself an{' '}
          <a
            className="text-brand-primary underline hover:text-brand-primary-hover inline-flex items-center gap-1"
            href="https://modelcontextprotocol.io/"
            target="_blank"
            rel="noreferrer"
          >
            MCP
          </a>{' '}
          client - the same tools you can trigger by typing below are also exposed as a real,
          independently-callable MCP server at <code>/api/admin-mcp</code>.
        </p>
      </OneTimeNote>

      <div className="mb-4 flex flex-col gap-3 rounded border border-surface-hairline p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium text-ink-primary">Step-up approval for bulk actions</div>
          <div className="text-xs text-ink-muted">
            Required before bulk_disable_contractors or bulk_enable_contractors will succeed, and
            expires 5 minutes after approval. Clicking below simulates the human-approval step of{' '}
            <a
              className="text-brand-primary underline hover:text-brand-primary-hover inline-flex items-center gap-1"
              href="https://auth0.com/docs/get-started/authentication-and-authorization-flow/client-initiated-backchannel-authentication-flow"
              target="_blank"
              rel="noreferrer"
            >
              CIBA
            </a>{' '}
            — no real phone, no real backchannel request. What <em>is</em> real: once you click
            Approve, the server records a step-up event, and FGA checks that record fresh on
            every bulk-action call afterward, so a bulk action can&apos;t succeed just because the
            chat UI claims it was approved.
          </div>
          {stepUpApprovedAt && (
            <div className="mt-1 text-xs text-status-good">Approved at {stepUpApprovedAt}</div>
          )}
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <button
            onClick={requestStepUp}
            disabled={stepUpPending}
            className="flex-1 rounded bg-brand-primary px-3 py-1 text-sm text-white hover:bg-brand-primary-hover disabled:opacity-40 sm:flex-none"
          >
            {stepUpPending ? '...' : 'Request step-up'}
          </button>
          <button
            onClick={stepDown}
            disabled={stepUpPending || !stepUpApprovedAt}
            className="flex-1 rounded bg-ink-secondary px-3 py-1 text-sm text-white disabled:opacity-40 sm:flex-none"
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
                <div className="my-1 rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm text-ink-primary">
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
                        ? 'bg-brand-primary text-white'
                        : 'bg-ink-secondary/10 text-ink-primary'
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
          className="rounded border border-brand-primary px-3 py-1 text-brand-primary disabled:opacity-40"
        >
          List contractors
        </button>
        <button
          onClick={() => send('Disable contractor-1')}
          disabled={status !== 'ready'}
          className="rounded border border-brand-primary px-3 py-1 text-brand-primary disabled:opacity-40"
        >
          Disable a contractor
        </button>
        <button
          onClick={() => send('Enable contractor-1')}
          disabled={status !== 'ready'}
          className="rounded border border-brand-primary px-3 py-1 text-brand-primary disabled:opacity-40"
        >
          Enable a contractor
        </button>
        <button
          onClick={() => send('Bulk disable contractor-2, contractor-3, and contractor-4')}
          disabled={status !== 'ready'}
          className="rounded border border-brand-primary px-3 py-1 text-brand-primary disabled:opacity-40"
        >
          Try a bulk action
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        &quot;Try a bulk action&quot; is denied on purpose until you request step-up above -
        that&apos;s the step-up gate in action.
      </p>

      {chatError && (
        <div className="mt-2 rounded border border-status-critical/40 bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">
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
          className="flex-1 rounded border border-surface-hairline px-3 py-2"
          placeholder="Ask about contractors..."
        />
        <button
          type="submit"
          className="rounded bg-brand-primary px-4 py-2 text-white hover:bg-brand-primary-hover"
          disabled={status !== 'ready'}
        >
          Send
        </button>
      </form>

      <div className="mt-6 border-t border-surface-hairline pt-4">
        <ResetMyDataButton persona="caseworker" />
      </div>
    </main>
  );
}
