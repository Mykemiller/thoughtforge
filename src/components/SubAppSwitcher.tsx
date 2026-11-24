"use client";
/**
 * Sub-app pull-down (FDY-443): ThoughtForge Panel (/) and Panel Podcast (/podcast), in the masthead AppBar row.
 *
 * Disclosure pattern (a button with aria-expanded controlling a list of links), not an ARIA menu: the entries are
 * plain navigation links, so Tab works as everywhere else. Keyboard: Enter/Space toggles; ArrowDown opens and
 * focuses the first entry; ArrowUp/ArrowDown/Home/End move between entries; Escape closes and returns focus to the
 * button; tabbing out of the group closes it. A click outside closes it. Motion only under
 * prefers-reduced-motion: no-preference (globals.css).
 *
 * Panel Podcast has no app_registry row on purpose: it is a sub-app of ThoughtForge, not a separate app.
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export const SUB_APPS = [
  { key: "panel", label: "ThoughtForge Panel", href: "/" },
  { key: "podcast", label: "Panel Podcast", href: "/podcast" },
] as const;

export type SubAppKey = (typeof SUB_APPS)[number]["key"];

/** /podcast and everything under it belongs to Panel Podcast; every other page is ThoughtForge Panel. */
export function subAppFor(pathname: string): SubAppKey {
  return pathname === "/podcast" || pathname.startsWith("/podcast/") ? "podcast" : "panel";
}

export function SubAppSwitcher({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const panelId = useId();
  const current = subAppFor(pathname);
  const currentLabel = SUB_APPS.find((s) => s.key === current)?.label ?? SUB_APPS[0].label;

  const items = () => Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
  const focusItem = (i: number) => {
    const all = items();
    if (all.length) all[(i + all.length) % all.length].focus();
  };

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(true); } };
    const onPointer = (e: PointerEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [open, close]);

  function onButtonKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const target = e.key === "ArrowDown" ? 0 : -1;
      requestAnimationFrame(() => focusItem(target));
    }
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(-1); }
  }

  return (
    <div
      className="tf-subapp"
      data-open={open ? "true" : "false"}
      ref={wrapRef}
      onBlur={(e) => { if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    >
      <button
        type="button"
        ref={btnRef}
        className="tf-subapp-btn"
        aria-expanded={open ? "true" : "false"}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKey}
      >
        <span className="tf-subapp-label">
          <span className="tf-visually-hidden">Switch ThoughtForge sub-app, current: </span>
          {currentLabel}
        </span>
        <span className="tf-subapp-caret" aria-hidden="true" />
      </button>
      <div className="tf-subapp-panel" id={panelId} hidden={!open}>
        <ul ref={listRef} onKeyDown={onListKey}>
          {SUB_APPS.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className="tf-subapp-item"
                aria-current={s.key === current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
