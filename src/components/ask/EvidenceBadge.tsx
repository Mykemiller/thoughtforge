import type { EvidenceTag } from "@/src/ask/sse";
import { TAG_LABEL } from "@/src/ask/render";

const STYLE: Record<EvidenceTag, string> = {
  VRF: "bg-primary text-surface",
  SRC: "bg-accent text-surface",
  EST: "bg-muted text-ink border border-line",
  INF: "bg-surface text-ink-muted border border-line",
};

export function EvidenceBadge({ tag, title }: { tag: EvidenceTag; title?: string | null }) {
  return (
    <span
      className={`mx-0.5 inline-flex max-w-full items-baseline gap-1 rounded-sm px-1.5 py-0.5 align-baseline font-mono text-[10px] leading-none tracking-[0.06em] ${STYLE[tag]}`}
      title={title ? `${TAG_LABEL[tag]}: ${title}` : TAG_LABEL[tag]}
    >
      {tag}
      {title ? <span className="truncate font-sans text-[10px] normal-case tracking-normal opacity-90">{title}</span> : null}
    </span>
  );
}

export function ContestedBadge({ from, to }: { from: EvidenceTag; to: EvidenceTag }) {
  return (
    <span
      className="mx-0.5 inline-flex items-baseline rounded-sm border border-accent bg-accent/10 px-1.5 py-0.5 align-baseline font-mono text-[10px] leading-none tracking-[0.06em] text-primary"
      title={`Fact-Checker downgraded this claim from ${from} to ${to}`}
    >
      contested · {from}→{to}
    </span>
  );
}
