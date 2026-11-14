import Link from "next/link";
import { Monogram } from "./Monogram";

/**
 * Primary nav. Order: Home, Panel, then the newest capability. On phones the wordmark already links home and
 * "Ask the panel" shortens to "Ask" below md, so five items fit from 375px up without horizontal scroll (TH-39).
 */
const NAV: { href: string; label: string; short?: string; desktopOnly?: boolean }[] = [
  { href: "/", label: "Home", desktopOnly: true },
  { href: "/panel", label: "Panel" },
  { href: "/ask", label: "Ask the panel", short: "Ask" },
  { href: "/interview", label: "1:1" },
  { href: "/podcast", label: "Podcast" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-primary text-surface">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-[var(--nav-height)] max-w-6xl items-center justify-between gap-2 px-4 sm:px-6 md:gap-6"
      >
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-sm sm:gap-3">
          <Monogram />
          <span className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-tight sm:text-lg">ThoughtForge</span>
            <span className="hidden font-mono text-[11px] tracking-[0.08em] text-accent sm:block">
              DATACENTER INSIGHTS &amp; ECOSYSTEMS
            </span>
          </span>
        </Link>
        <ul className="flex items-center md:gap-2">
          {NAV.map((item) => (
            <li key={item.href} className={item.desktopOnly ? "hidden md:block" : undefined}>
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-card px-1.5 text-sm font-medium text-surface/90 hover:bg-surface/10 hover:text-surface md:px-3"
              >
                {item.short ? (
                  <>
                    <span className="md:hidden">{item.short}</span>
                    <span className="hidden md:inline">{item.label}</span>
                  </>
                ) : (
                  item.label
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
