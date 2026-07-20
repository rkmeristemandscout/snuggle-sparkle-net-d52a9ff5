import { Link } from "@tanstack/react-router";

// Renders text with @[Name](uuid) mentions highlighted.
const MENTION_RE = /@\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)/g;

export function MentionContent({ text }: { text: string }) {
  const parts: Array<{ type: "text" | "mention"; value: string; id?: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE);
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    parts.push({ type: "mention", value: m[1], id: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });

  return (
    <p className="whitespace-pre-wrap text-sm">
      {parts.map((p, i) =>
        p.type === "mention" ? (
          <Link
            key={i}
            to="/profile"
            className="mx-0.5 rounded bg-primary/10 px-1 font-medium text-primary hover:bg-primary/20"
          >
            @{p.value}
          </Link>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  );
}
