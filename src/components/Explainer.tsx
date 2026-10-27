'use client';

import { useEffect, useRef } from 'react';
import { hasSeenStep, markStepSeen, type WalkthroughStep } from '@/lib/walkthroughSteps';

/**
 * Wraps a narration/explainer block under a collapsible "Explainer"
 * title. Always rendered (never hidden), but starts expanded the first
 * time a given step is seen in this browser session and collapsed on
 * every later view - still expandable at any time either way.
 *
 * `open` is rendered unconditionally so server and client markup always
 * agree - the "should this start collapsed" correction happens
 * imperatively on the DOM node after mount, never as a render-time
 * branch, so there's nothing for hydration to mismatch on.
 *
 * `initiallyEligible` gates whether this note is even a candidate to show
 * on THIS load (e.g. a server-computed "was this just provisioned"
 * check), independent of the open/collapsed default above.
 */
export default function Explainer({
  step,
  initiallyEligible = true,
  children,
}: {
  step: WalkthroughStep;
  initiallyEligible?: boolean;
  children: React.ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (detailsRef.current && hasSeenStep(step)) {
      detailsRef.current.open = false;
    }
    markStepSeen(step);
  }, [step]);

  if (!initiallyEligible) return null;

  return (
    <details ref={detailsRef} open className="mt-3 rounded border border-surface-hairline p-3">
      <summary className="cursor-pointer font-medium text-ink-primary">Explainer</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
