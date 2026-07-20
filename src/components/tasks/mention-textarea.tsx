import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";

export type MentionMember = { id: string; full_name: string | null };

type Props = {
  value: string;
  onChange: (v: string) => void;
  members: MentionMember[];
  placeholder?: string;
  rows?: number;
};

// Textarea that opens a mention picker when the user types '@'.
// Inserts the mention as @[Name](uuid).
export function MentionTextarea({ value, onChange, members, placeholder, rows = 2 }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);

  const filtered = members
    .filter((m) => (m.full_name ?? "").toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);
    const caret = e.target.selectionStart ?? v.length;
    // find last '@' before caret with no whitespace after it
    const upto = v.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at >= 0) {
      const between = upto.slice(at + 1);
      if (!/\s/.test(between) && between.length <= 30 && (at === 0 || /\s|^/.test(upto[at - 1] ?? ""))) {
        setTriggerPos(at);
        setQuery(between);
        setOpen(true);
        return;
      }
    }
    setOpen(false);
    setTriggerPos(null);
  };

  const insertMention = (m: MentionMember) => {
    if (triggerPos == null) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, triggerPos);
    const after = value.slice(caret);
    const token = `@[${m.full_name ?? "Unnamed"}](${m.id}) `;
    const next = before + token + after;
    onChange(next);
    setOpen(false);
    setTriggerPos(null);
    requestAnimationFrame(() => {
      if (el) {
        const pos = (before + token).length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % filtered.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (h - 1 + filtered.length) % filtered.length); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filtered[highlight]); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-60 w-64 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {filtered.map((m, i) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
              className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left ${
                i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
              }`}
            >
              <span className="truncate">@{m.full_name ?? "Unnamed"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
