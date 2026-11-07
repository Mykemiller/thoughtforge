"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TeamPhoto } from "@/src/data/team-photos";

export const MEET_TEAM_STORAGE_KEY = "tf.meetTeam.open";

export interface TeamBio {
  slug: string;
  name: string;
  role: string;
  thumb: string;
  alt: string;
  bio: string; // first paragraph of linkedin.md About, plain text
}

/** Storage reads and writes never throw: a blocked store just means "closed, unremembered". */
export function readOpen(storage?: Pick<Storage, "getItem">): boolean {
  try {
    return (storage ?? window.localStorage).getItem(MEET_TEAM_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
export function writeOpen(open: boolean, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? window.localStorage).setItem(MEET_TEAM_STORAGE_KEY, open ? "1" : "0");
  } catch {
    /* storage unavailable: ignore */
  }
}

/** Formal shots first, then candid; order within a kind is kept. */
export function orderPhotos(photos: TeamPhoto[]): TeamPhoto[] {
  return [...photos.filter((p) => p.kind === "formal"), ...photos.filter((p) => p.kind === "candid")];
}

function Lightbox({ photo, onClose }: { photo: TeamPhoto; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        e.preventDefault(); // single focusable control: keep focus on Close
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.title}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-ink/90 p-4"
      onClick={onClose}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex min-h-11 items-center rounded-card bg-surface px-4 text-sm font-semibold text-primary"
      >
        Close
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.file}
        alt={photo.alt}
        className="max-h-[80vh] w-auto max-w-full rounded-card"
        onClick={(e) => e.stopPropagation()}
      />
      <p className="text-sm text-surface">{photo.caption}</p>
    </div>
  );
}

export function Gallery({
  photos,
  onSelect = () => {},
  setRef = () => {},
}: {
  photos: TeamPhoto[];
  onSelect?: (id: string) => void;
  setRef?: (id: string, el: HTMLButtonElement | null) => void;
}) {
  if (photos.length === 0) return <p className="text-sm text-ink-muted">Group photos coming soon</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="list">
      {photos.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            ref={(el) => setRef(p.id, el)}
            onClick={() => onSelect(p.id)}
            aria-label={`${p.title}: view larger`}
            className="group relative block w-full overflow-hidden rounded-card border border-line"
          >
            <Image
              src={p.fileSm}
              alt={p.alt}
              width={800}
              height={450}
              loading="lazy"
              sizes="(min-width: 640px) 25vw, 50vw"
              className="aspect-video w-full object-cover"
            />
            <span className="absolute inset-x-0 bottom-0 bg-primary/85 px-2 py-1 text-left text-xs text-surface opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {p.caption}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MeetTheTeam({ photos, bios }: { photos: TeamPhoto[]; bios: TeamBio[] }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const thumbRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const ordered = orderPhotos(photos);

  useEffect(() => {
    // Hydration-safe restore of the remembered state: storage is unreadable during SSR.
    if (readOpen()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
      setEverOpened(true);
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setEverOpened(true);
    writeOpen(next);
  };

  const closeLightbox = useCallback(() => {
    setActive((id) => {
      if (id) requestAnimationFrame(() => thumbRefs.current[id]?.focus());
      return null;
    });
  }, []);

  const activePhoto = ordered.find((p) => p.id === active) ?? null;

  return (
    <section aria-labelledby="meet-team-heading" className="border-t border-line">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="meet-team-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
            className="flex min-h-14 w-full items-center justify-between gap-4 py-6 text-left"
          >
            <span>Meet the Team</span>
            <span aria-hidden="true" className={`text-primary transition-transform ${open ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>
        </h2>

        <div id={panelId} hidden={!open} className="pb-14">
          {everOpened && (
            <>
              <Gallery
                photos={ordered}
                onSelect={setActive}
                setRef={(id, el) => {
                  thumbRefs.current[id] = el;
                }}
              />
            </>
          )}

          <ul className="mt-10 grid gap-4 sm:grid-cols-2" role="list">
            {bios.map((b) => (
              <li key={b.slug} className="flex gap-4 rounded-card border border-line bg-surface p-5">
                <Image
                  src={b.thumb}
                  alt={b.alt}
                  width={96}
                  height={96}
                  loading="lazy"
                  className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-line sm:h-24 sm:w-24"
                />
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink">{b.name}</h3>
                  <p className="font-mono text-xs uppercase tracking-[0.08em] text-accent">{b.role}</p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{b.bio}</p>
                  <Link
                    href={`/panel/${b.slug}`}
                    className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Full bio
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {activePhoto && <Lightbox photo={activePhoto} onClose={closeLightbox} />}
    </section>
  );
}
