"use client";
/**
 * Site chrome (FDY-447 · BRAND-1c, FDY-443): the shared Faraday masthead (vendored, lib/faraday-masthead/) with
 * "ThoughtForge Panel" in its context slot, and ThoughtForge's own navigation in the AppBar directly under it.
 * Replaces the old teal SiteNav and the "TF" roundel; teal stays allowed inside page content, not in the top bar.
 *
 * AppBar row: the sub-app pull-down (ThoughtForge Panel / Panel Podcast, FDY-443), then Home, Panel, Ask the panel,
 * 1:1, Podcast (same targets as the old nav). Links are passed as AppBar children (same `fm-applink` class the
 * package uses) so the switcher can lead the row and "Ask the panel" can shorten to "Ask" on phones.
 *
 * No sign-in control here: ThoughtForge has no site-wide sign-in route; the Faraday gate (lib/faraday-gate) shows
 * its own masthead with "Sign in" on the gated surfaces. When the gate page renders, this chrome hides itself
 * (globals.css, `body:has(#fg-main)`), so a visitor never sees two mastheads.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppBar, Masthead } from "@/lib/faraday-masthead/ui/Masthead.tsx";
import { SubAppSwitcher } from "./SubAppSwitcher";

export const TF_APP_NAME = "ThoughtForge Panel";

const NAV: { href: string; label: string; short?: string }[] = [
  { href: "/", label: "Home" },
  { href: "/panel", label: "Panel" },
  { href: "/ask", label: "Ask the panel", short: "Ask" },
  { href: "/interview", label: "1:1" },
  { href: "/podcast", label: "Podcast" },
];

/** The nav item a path belongs to: exact match for Home, prefix match for the rest. */
export function currentNavHref(pathname: string): string | null {
  if (pathname === "/") return "/";
  const hit = NAV.find((n) => n.href !== "/" && (pathname === n.href || pathname.startsWith(`${n.href}/`)));
  return hit ? hit.href : null;
}

export function SiteChrome() {
  const pathname = usePathname() || "/";
  const current = currentNavHref(pathname);
  return (
    <>
      <div className="tf-mast">
        <Masthead appName={TF_APP_NAME} homeHref="/" signIn={<></>} loadFonts />
      </div>
      <div className="tf-appbar">
        <AppBar label={TF_APP_NAME}>
          <SubAppSwitcher pathname={pathname} />
          <span className="tf-appbar-sep" aria-hidden="true" />
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="fm-applink"
              aria-current={current === item.href ? "page" : undefined}
            >
              {item.short ? (
                <>
                  <span className="tf-short" aria-hidden="true">{item.short}</span>
                  <span className="tf-long">{item.label}</span>
                </>
              ) : (
                item.label
              )}
            </Link>
          ))}
        </AppBar>
      </div>
    </>
  );
}
