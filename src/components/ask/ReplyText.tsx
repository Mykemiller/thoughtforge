import type { FactcheckItem } from "@/src/ask/sse";
import { segmentReply } from "@/src/ask/render";
import { ContestedBadge, EvidenceBadge } from "./EvidenceBadge";

export function ReplyText({ text, contested }: { text: string; contested: FactcheckItem[] }) {
  const segs = segmentReply(text, contested);
  return (
    <p className="whitespace-pre-wrap leading-relaxed text-ink">
      {segs.map((s, i) => {
        if (s.kind === "text") return <span key={i}>{s.text}</span>;
        if (s.kind === "tag") return <EvidenceBadge key={i} tag={s.tag} title={s.title} />;
        return (
          <span key={i} className="rounded-sm bg-accent/10 underline decoration-accent decoration-dotted underline-offset-4" title={s.item.note}>
            {s.text}
            <ContestedBadge from={s.item.tag_given} to={s.item.tag_should_be} />
          </span>
        );
      })}
    </p>
  );
}
