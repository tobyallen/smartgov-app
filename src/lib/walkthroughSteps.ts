'use client';

// Tracks which explainer/narration steps a visitor has already seen, in
// sessionStorage - not a backend, not tied to the Auth0 session, gone the
// moment the tab closes. "Seen" no longer hides a step's content; each
// Explainer block stays on the page permanently and just defaults to
// collapsed once its step has been seen before, instead of expanded.
// Six independent pages share this, each with its own framing copy.
// Without this, the case page's "what just happened during signup" note
// only appears/disappears based on a 30s createdAt window - a reload at
// 31s loses it permanently, a reload at 10s repeats it needlessly. Neither
// tracks the actual narrative; this does.

export type WalkthroughStep =
  | 'landing-seen'
  | 'case-provisioning-note-seen'
  | 'case-fga-explainer-seen'
  | 'chat-delegation-explainer-seen'
  | 'admin-rbac-explainer-seen'
  | 'admin-mcp-explainer-seen'
  | 'access-log-explainer-seen';

const KEY = 'smartgov.walkthroughSteps';

function readSeen(): Set<WalkthroughStep> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as WalkthroughStep[]) : []);
  } catch {
    return new Set();
  }
}

export function hasSeenStep(step: WalkthroughStep): boolean {
  return readSeen().has(step);
}

export function markStepSeen(step: WalkthroughStep): void {
  if (typeof window === 'undefined') return;
  const seen = readSeen();
  if (seen.has(step)) return;
  seen.add(step);
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    // sessionStorage unavailable (private browsing, quota) - narration
    // copy just shows every time instead of once. Not worth failing over.
  }
}

// Used by ResetMyDataButton after /api/dev/reset succeeds - a citizen
// replaying the walkthrough fresh should see the one-time narration
// again too, not just get fresh case/agent/FGA state with stale
// "already seen this" flags left over from the account's first pass.
export function clearAllSeenSteps(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Same as markStepSeen above - not worth failing over.
  }
}
