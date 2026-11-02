/** Static params for /panel/[slug]: exactly the ten manifest slugs (TF-DEC-31). */
import { PANEL_SORTED } from "../data/panel";

export function panelStaticParams(): { slug: string }[] {
  return PANEL_SORTED.map((m) => ({ slug: m.slug }));
}
