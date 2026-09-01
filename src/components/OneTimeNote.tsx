'use client';

import { useEffect, useState } from 'react';
import { hasSeenStep, markStepSeen, type WalkthroughStep } from '@/lib/walkthroughSteps';

/**
 * Wraps a one-time explainer/narration block. Renders once per browser
 * session (sessionStorage, not the Auth0 session) then hides itself on
 * every later visit/reload — this is what "reload resumes the same point
 * in the narrative" means for a page with no numbered wizard steps.
 *
 * `initiallyEligible` gates whether this note is even a candidate to show
 * on THIS load (e.g. a server-computed "was this just provisioned"
 * check) — sessionStorage then decides whether it's *already* been shown
 * regardless of eligibility, so a visitor who reloads after the eligible
 * window has passed doesn't lose it, and one who reloads within the
 * window doesn't see it repeat.
 */
export default function OneTimeNote({
  step,
  initiallyEligible = true,
  children,
}: {
  step: WalkthroughStep;
  initiallyEligible?: boolean;
  children: React.ReactNode;
}) {
  // Lazy initializer, not an effect: hasSeenStep() always returns false
  // during SSR (no sessionStorage on the server), matching the eventual
  // client-side read on first mount, so there's no hydration mismatch to
  // worry about — just a real client value computed once, up front,
  // rather than a derived state update after paint.
  const [visible] = useState(() => initiallyEligible && !hasSeenStep(step));

  // Marking as seen is a genuine side effect (writing to an external
  // system, sessionStorage) — that belongs in an effect. It just never
  // calls setState itself, so it can't trigger the cascading-render
  // pattern the lint rule is guarding against.
  useEffect(() => {
    if (visible) markStepSeen(step);
  }, [visible, step]);

  if (!visible) return null;
  return <>{children}</>;
}
