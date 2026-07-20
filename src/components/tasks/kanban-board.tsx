import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CalendarClock, GripVertical } from "lucide-react";

export type KanbanTask = {
  id: string;
  organization_id: string;
  title: string;
  code: string | null;
  status: string;
  priority: string;
  progress: number;
  due_date: string | null;
  assignee_id: string | null;
  archived_at: string | null;
};

const STATUSES = ["todo", "in_progress", "in_review", "blocked", "done", "cancelled"] as const;
type S = (typeof STATUSES)[number];

const STATUS_LABEL: Record<S, string> = {
  todo: "To do", in_progress: "In progress", in_review: "In review",
  blocked: "Blocked", done: "Done", cancelled: "Cancelled",
};

const statusColor: Record<S, string> = {
  todo: "border-slate-300",
  in_progress: "border-blue-400",
  in_review: "border-amber-400",
  blocked: "border-red-400",
  done: "border-emerald-400",
  cancelled: "border-zinc-300",
};

const priorityColor = (p: string) =>
  ({
    low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
    high: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200",
    urgent: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
  }[p] ?? "");

type Props = {
  tasks: KanbanTask[];
  orgId: string;
  memberName: (id: string | null) => string;
  onMove: (taskId: string, newStatus: S) => Promise<void> | void;
  onRealtime: () => void;
};

export function KanbanBoard({ tasks, orgId, memberName, onMove, onRealtime }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<S | null>(null);

  useEffect(() => {
    const ch = supabase
      .channel(`kanban-tasks-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `organization_id=eq.${orgId}` },
        () => onRealtime(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orgId, onRealtime]);

  const grouped = STATUSES.map((s) => ({ s, rows: tasks.filter((t) => t.status === s) }));

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[900px] grid-cols-6 gap-3 p-4">
        {grouped.map(({ s, rows }) => (
          <div
            key={s}
            onDragOver={(e) => { e.preventDefault(); setOverCol(s); }}
            onDragLeave={() => setOverCol((c) => (c === s ? null : c))}
            onDrop={async (e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragId;
              setDragId(null); setOverCol(null);
              if (id) await onMove(id, s);
            }}
            className={`rounded-lg border bg-muted/30 ${overCol === s ? "ring-2 ring-primary" : ""}`}
          >
            <div className={`flex items-center justify-between border-l-4 px-3 py-2 ${statusColor[s]}`}>
              <p className="text-xs font-semibold uppercase tracking-wide">{STATUS_LABEL[s]}</p>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs">{rows.length}</span>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {rows.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">Drop tasks here</p>
              )}
              {rows.map((t) => {
                const overdue = t.due_date && s !== "done" && s !== "cancelled" && new Date(t.due_date) < new Date(new Date().toDateString());
                return (
                  <Card
                    key={t.id}
                    draggable
                    onDragStart={(e) => { setDragId(t.id); e.dataTransfer.setData("text/plain", t.id); }}
                    onDragEnd={() => setDragId(null)}
                    className={`cursor-grab active:cursor-grabbing p-3 ${t.archived_at ? "opacity-60" : ""} ${dragId === t.id ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        {t.code && <p className="font-mono text-[10px] text-muted-foreground">{t.code}</p>}
                        <Link to="/tasks/$taskId" params={{ taskId: t.id }} className="line-clamp-2 text-sm font-medium hover:underline">
                          {t.title}
                        </Link>
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          <Badge className={`capitalize ${priorityColor(t.priority)} text-[10px]`}>{t.priority}</Badge>
                          {t.due_date && (
                            <span className={`inline-flex items-center gap-1 text-[10px] ${overdue ? "font-medium text-red-600" : "text-muted-foreground"}`}>
                              <CalendarClock className="h-3 w-3" />
                              {t.due_date}
                            </span>
                          )}
                        </div>
                        {t.assignee_id && (
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">{memberName(t.assignee_id)}</p>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
