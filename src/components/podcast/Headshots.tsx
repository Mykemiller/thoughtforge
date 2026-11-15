import Image from "next/image";
import Link from "next/link";
import { PANEL, panelAlt } from "../../data/panel";
import type { CastSlot } from "../../podcast/episodes";

/** On-mic headshots: the committed panel thumbnails (already cropped on cropFocusY by panel:sync). Unknown slugs are skipped. */
export function Headshots({ cast, size = 40, link = false }: { cast: CastSlot[]; size?: number; link?: boolean }) {
  const members = cast.map((c) => ({ c, m: PANEL.find((p) => p.slug === c.slug) })).filter((x) => x.m);
  if (!members.length) return null;
  return (
    <ul className="flex -space-x-2" role="list" aria-label="On mic">
      {members.map(({ c, m }) => {
        const img = (
          <Image src={m!.thumb} alt={panelAlt(m!)} width={size} height={size} sizes={`${size}px`} className="h-full w-full object-cover" />
        );
        return (
          <li key={c.slug} className="relative block overflow-hidden rounded-full ring-2 ring-surface" style={{ width: size, height: size }}>
            {link ? <Link href={`/panel/${c.slug}`} aria-label={`${m!.name}, ${m!.role}`}>{img}</Link> : img}
          </li>
        );
      })}
    </ul>
  );
}

export function castName(slug: string): string {
  return PANEL.find((p) => p.slug === slug)?.name ?? slug;
}

export function castNames(): Record<string, string> {
  return Object.fromEntries(PANEL.map((p) => [p.slug, p.name]));
}
