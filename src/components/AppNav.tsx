import Link from 'next/link';
import { Logo } from '@/components/Logo';

export type NavLink = {
  label: string;
  href: string;
  /**
   * internal: another page in this app (primary blue, no icon).
   * external: leaves the app entirely - Auth0 docs, MCP spec, GitHub
   * (primary blue + a small external-link glyph + opens in a new tab),
   * so a reader can tell "this takes me away from the demo" at a glance
   * rather than discovering it only after clicking.
   * destructive: ends the current session (secondary ink, not brand
   * blue, so "Log out" doesn't visually blend into ordinary navigation).
   */
  role?: 'internal' | 'external' | 'destructive';
};

const ROLE_CLASSES: Record<NonNullable<NavLink['role']>, string> = {
  internal: 'text-brand-primary underline hover:text-brand-primary-hover',
  external: 'text-brand-primary underline hover:text-brand-primary-hover inline-flex items-center gap-1',
  destructive: 'text-ink-secondary underline hover:text-ink-primary',
};

export function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M14 5h5v5M19 5 10 14M8 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One shared nav row, replacing the near-identical `<div className="mb-4
 * flex gap-4 text-sm">` block every page rolled independently before
 * this (case, chat, admin, access-log, recap, dev-tools, home - each
 * with its own slightly different link set, since the right links
 * genuinely differ by page and by persona). This component doesn't
 * decide WHICH links to show - each page keeps its own existing
 * isCaseworker()/hasDevToolsRole() branching and just passes the
 * resulting array in - it only standardizes HOW they render, including
 * the three link-role treatments (internal/external/destructive) that
 * previously all looked identical regardless of what clicking them did.
 */
export function AppNav({ links }: { links: NavLink[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-surface-hairline py-3 text-sm">
      <div className="flex items-center gap-2">
        <Logo size={24} />
        <span className="font-semibold text-ink-primary">SmartGov</span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {links.map((link) => {
          const role = link.role ?? 'internal';
          const className = ROLE_CLASSES[role];
          if (role === 'external') {
            return (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className={className}>
                {link.label}
                <ExternalIcon />
              </a>
            );
          }
          if (link.href.startsWith('/auth/')) {
            // Auth0's own login/logout routes - not a Next.js page, so a
            // plain <a> (not <Link>) is deliberate here, same as every
            // page already did before this component existed.
            return (
              <a key={link.href} href={link.href} className={className}>
                {link.label}
              </a>
            );
          }
          return (
            <Link key={link.href} href={link.href} className={className}>
              {link.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
