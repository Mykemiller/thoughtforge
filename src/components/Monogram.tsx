/**
 * Placeholder for the ThoughtForge Primary Monogram ("TF" in a circle with a
 * lightning-bolt slash). The approved PNG (public/brand/thoughtforge-primary-
 * monogram.png, per TH-10) is not in the repo yet; swap this for <Image> when
 * it lands. Decorative inside the wordmark link, so aria-hidden.
 */
export function Monogram({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-accent bg-primary font-bold text-surface"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      TF
    </span>
  );
}
