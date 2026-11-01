import Image from "next/image";
import Link from "next/link";
import { PANEL_SORTED, panelAlt } from "@/src/data/panel";

/**
 * Landing-page headshot strip: ten round thumbnails (96px desktop, 72px
 * mobile) in a 5×2 / 2-wide grid, each deep-linking to /panel#<slug>.
 */
export function PanelStrip() {
  return (
    <section aria-labelledby="panel-strip-heading" className="border-t border-line bg-muted">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">THE PANEL</p>
            <h2 id="panel-strip-heading" className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              The Panel
            </h2>
            <p className="mt-2 max-w-xl text-ink-muted">
              Ten advisors, each with a domain and a point of view. They argue in the open; the Chief of
              Staff rules.
            </p>
          </div>
          <Link
            href="/panel"
            className="inline-flex min-h-11 items-center rounded-card px-2 text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            Meet the full panel →
          </Link>
        </div>

        <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-5" role="list">
          {PANEL_SORTED.map((m) => (
            <li key={m.slug} className="flex justify-center">
              <Link
                href={`/panel#${m.slug}`}
                className="group flex w-full max-w-[9.5rem] flex-col items-center gap-3 rounded-card p-2 text-center"
              >
                <span className="relative block h-[72px] w-[72px] overflow-hidden rounded-full ring-2 ring-line transition-shadow group-hover:ring-accent sm:h-24 sm:w-24">
                  <Image
                    src={m.thumb}
                    alt={panelAlt(m)}
                    width={96}
                    height={96}
                    sizes="(min-width: 640px) 96px, 72px"
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold text-ink group-hover:text-primary">{m.name}</span>
                  <span className="mt-0.5 text-xs text-ink-muted">{m.role}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
