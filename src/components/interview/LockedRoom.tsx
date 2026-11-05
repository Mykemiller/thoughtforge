import Link from "next/link";

/** The magic-word form, shared by /interview pages when the gate rewrites them locked (same behaviour as /ask). */
export function LockedRoom({ action, denied }: { action: string; denied: boolean }) {
  return (
    <section className="max-w-xl rounded-card border border-line bg-muted p-6">
      <p className="font-mono text-xs tracking-[0.08em] text-ink-muted">PRIVATE</p>
      <h2 className="mt-2 text-xl font-bold tracking-tight">The interview room is private for now.</h2>
      <p className="mt-3 leading-relaxed text-ink-muted">
        The 1:1 interviews are open to the panel&apos;s owner only. The panelists themselves are public: you can read who they are and how they argue.
      </p>
      <form method="get" action={action} className="mt-6 flex flex-col gap-2" aria-describedby={denied ? "magic-word-denied" : undefined}>
        <label htmlFor="magic-word" className="text-sm font-semibold text-ink">
          Say the magic word to enter the room
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="magic-word"
            name="key"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            placeholder="Magic word"
            className="min-h-11 flex-1 rounded-card border border-line bg-surface px-4 text-base text-ink placeholder:text-ink-muted/70 focus:border-accent"
          />
          <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-card bg-primary px-5 text-sm font-semibold text-surface hover:bg-primary/90">
            Enter
          </button>
        </div>
        {denied ? (
          <p id="magic-word-denied" role="alert" className="text-sm text-accent">
            That was not the word. Try again.
          </p>
        ) : (
          <p className="text-xs text-ink-muted">The word stays in this browser for 90 days.</p>
        )}
      </form>
      <Link href="/panel" className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline">
        Meet the Panel →
      </Link>
    </section>
  );
}
