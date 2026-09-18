'use client';

import { useEffect, useState } from 'react';

type ApprovalState = 'waiting' | 'phone' | 'approved' | 'denied';

export type CibaApprovalProps = {
  onClose: () => void;
  onComplete: (approved: boolean) => void;
};

/**
 * Simulated out-of-band step-up approval — NOT a real Auth0 CIBA
 * integration (no backchannel auth request, no push notification, no
 * second device). This exists purely to dramatize, for a workshop
 * audience, the out-of-band moment that /api/request-step-up's own
 * comment admits today's one-click POST skips entirely ("a real system
 * would use CIBA or a fresh MFA challenge here — this route is a
 * deliberate demo shortcut, not a pattern to copy"). onComplete(true)
 * is the only thing that should trigger the real POST to
 * /api/request-step-up; this component never calls it itself, so the
 * actual authorization write still only ever happens through the
 * existing, real route.
 *
 * The caller (AdminChat.tsx) only ever mounts this component while the
 * modal should be visible, and remounts it fresh on each open via a
 * changing `key` — so state/secondsRemaining start clean at their
 * useState defaults every time, with no reset-on-mount effect needed
 * (an effect that calls setState synchronously on mount just to reset
 * state trips react-hooks/set-state-in-effect as a cascading-render risk).
 */
export function CibaApproval({ onClose, onComplete }: CibaApprovalProps) {
  const [state, setState] = useState<ApprovalState>('waiting');
  const [secondsRemaining, setSecondsRemaining] = useState(30);

  useEffect(() => {
    const notificationTimer = setTimeout(() => {
      setState('phone');
    }, 1500);

    return () => clearTimeout(notificationTimer);
  }, []);

  useEffect(() => {
    if (state !== 'phone' || secondsRemaining <= 0) return;

    const timer = setInterval(() => {
      setSecondsRemaining((seconds) => seconds - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [state, secondsRemaining]);

  async function approve() {
    setState('approved');
    await wait(1500);
    onComplete(true);
  }

  async function deny() {
    setState('denied');
    await wait(1500);
    onComplete(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex items-start gap-6">
        {/* AI agent / caseworker console status */}
        <section className="w-80 rounded-xl bg-white p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-gray-900">Bulk contractor step-up</h2>
          <p className="text-sm text-gray-500">Human approval required (simulated CIBA)</p>

          <div className="my-6 text-center">
            {state === 'waiting' && (
              <>
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
                <p className="mt-3 font-medium text-gray-900">Awaiting approval...</p>
                <p className="text-sm text-gray-500">Sending request to the caseworker&apos;s phone</p>
              </>
            )}

            {state === 'phone' && (
              <>
                <div className="text-4xl text-gray-900">1</div>
                <p className="mt-3 font-medium text-gray-900">Approval request sent</p>
                <p className="text-sm text-gray-500">Expires in {secondsRemaining}s</p>
              </>
            )}

            {state === 'approved' && (
              <>
                <div className="text-4xl text-green-600">✓</div>
                <p className="font-medium text-green-600">Approved</p>
                <p className="text-sm text-gray-500">Recording step-up approval...</p>
              </>
            )}

            {state === 'denied' && (
              <>
                <div className="text-4xl text-red-600">×</div>
                <p className="font-medium text-red-600">Denied</p>
                <p className="text-sm text-gray-500">Step-up was not approved</p>
              </>
            )}
          </div>

          <div className="rounded-lg bg-gray-100 p-3 font-mono text-xs text-gray-800">
            {/* caseworker_can_bulk_disable gates BOTH bulk_disable_contractors and
                bulk_enable_contractors - see adminTools.ts - so this deliberately
                doesn't name one direction over the other. */}
            <p>Action: bulk_disable_contractors / bulk_enable_contractors</p>
            <p>Grant: caseworker_can_bulk_disable</p>
            <p>Condition: step_up_approved</p>
            <p>
              Status:{' '}
              {state === 'approved' ? 'APPROVED' : state === 'denied' ? 'DENIED' : 'PENDING'}
            </p>
          </div>

          <button
            onClick={onClose}
            className="mt-4 w-full rounded-lg border px-4 py-2 text-gray-900"
          >
            Cancel
          </button>
        </section>

        {/* Simulated mobile approval screen */}
        {(state === 'phone' || state === 'approved' || state === 'denied') && (
          <section className="w-64 rounded-[2rem] border-8 border-gray-900 bg-white p-4 shadow-2xl">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-black text-sm font-bold text-white">
                SG
              </div>
              <h3 className="font-semibold text-gray-900">SmartGov</h3>
              <p className="text-xs text-gray-500">Caseworker approval</p>
            </div>

            {state === 'phone' && (
              <>
                <div className="my-5 rounded-xl border p-3">
                  <p className="text-xs uppercase text-gray-500">Your admin console requests</p>
                  <p className="mt-2 font-semibold text-gray-900">Bulk contractor action</p>
                  <p className="mt-3 text-xl font-bold text-gray-900">Step-up approval</p>
                  <p className="text-xs text-gray-500">
                    Required before a bulk enable or bulk disable can run
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={deny}
                    className="flex-1 rounded-lg border border-red-600 px-3 py-2 text-red-600"
                  >
                    Deny
                  </button>
                  <button
                    onClick={approve}
                    className="flex-1 rounded-lg bg-black px-3 py-2 text-white"
                  >
                    Approve
                  </button>
                </div>
              </>
            )}

            {state === 'approved' && (
              <div className="py-10 text-center text-green-600">
                <div className="text-5xl">✓</div>
                <p className="mt-3 font-semibold">Approved</p>
              </div>
            )}

            {state === 'denied' && (
              <div className="py-10 text-center text-red-600">
                <div className="text-5xl">×</div>
                <p className="mt-3 font-semibold">Denied</p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
