import Link from "next/link";
import { Monogram } from "./Monogram";

/** Primary nav. Order: Home, Panel, then the newest capability. */
const NAV = [
  { href: "/", label: "Home" },
  { href: "/panel", label: "Panel" },
  { href: "/ask", label: "Ask the panel" },
] as const;

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-primary text-surface">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-[var(--nav-height)] max-w-6xl items-center justify-between gap-6 px-4 sm:px-6"
      >
        <Link href="/" className="flex items-center gap-3 rounded-sm">
          <Monogram />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-bold tracking-tight">ThoughtForge</span>
            <span className="hidden font-mono text-[11px] tracking-[0.08em] text-accent sm:block">
              DATACENTER INSIGHTS &amp; ECOSYSTEMS
            </span>
          </span>
        </Link>
        <ul className="flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-card px-3 text-sm font-medium text-surface/90 hover:bg-surface/10 hover:text-surface"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
