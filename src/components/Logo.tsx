// Extracted from the "SG" square badge already used inside the CIBA
// approval modal (CibaApproval.tsx) - generalized into a reusable mark
// so the app's one existing bit of visual identity becomes the actual
// brand, reused in every page's nav, rather than a one-off decoration
// inside a single modal. A fake brand for a fictional civic-tech demo
// product, same footing as the app's own "mock data" framing elsewhere.
export function Logo({
  size = 28,
  className = 'bg-ink-primary text-background',
}: {
  size?: number;
  // Override for surfaces that are always light/dark regardless of the
  // app's own theme (e.g. CibaApproval's fixed-white phone mockup card)
  // - the default tracks the app's theme tokens, which would otherwise
  // invert unexpectedly inside a surface that deliberately doesn't.
  className?: string;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-lg font-bold ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      SG
    </div>
  );
}
