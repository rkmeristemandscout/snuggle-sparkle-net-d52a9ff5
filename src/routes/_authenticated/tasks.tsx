import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listTasks, getTasksStats, createTask, updateTask, deleteTask,
  archiveTask, restoreTask, completeTask, duplicateTask,
} from "@/lib/tasks.functions";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Search, RefreshCw, Download, MoreHorizontal, Pencil, Trash2, Copy,
  CheckCircle2, Archive, ArchiveRestore, Eye, ListChecks, Clock, AlertTriangle,
  CalendarClock, TrendingUp, Flame, LayoutGrid, List as ListIcon, X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { KanbanBoard, type KanbanTask } from "@/components/tasks/kanban-board";

export const Route = createFileRoute("/_authenticated/tasks")({ component: TasksPage });

const STATUSES = ["todo", "in_progress", "in_review", "blocked", "done", "cancelled"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type TaskStatus = (typeof STATUSES)[number];
type TaskPriority = (typeof PRIORITIES)[number];

type TaskRow = {
  id: string; organization_id: string; project_id: string; team_id: string | null;
  department_id: string | null; assignee_id: string | null; reporter_id: string | null;
  title: string; code: string | null; description: string | null;
  status: string; priority: string; progress: number;
  estimated_hours: number | null; logged_hours: number;
  start_date: string | null; due_date: string | null; labels: string[] | null;
  archived_at: string | null; deleted_at: string | null;
  created_at: string; updated_at: string;
};

type Profile = { id: string; full_name: string | null; avatar_url: string | null };
type Named = { id: string; name: string };

const PAGE_SIZE = 25;

const statusColor = (s: string) =>
  ({
    todo: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
    in_review: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    blocked: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
    done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    cancelled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  }[s] ?? "");

const priorityColor = (p: string) =>
  ({
    low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
    high: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200",
    urgent: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
  }[p] ?? "");

function TasksPage() {
  const { currentMembership } = useCurrentOrg();
  const { can } = usePermissions();
  const org = currentMembership?.organization;
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState<string>("all");
  const [teamId, setTeamId] = useState<string>("all");
  const [departmentId, setDepartmentId] = useState<string>("all");
  const [assigneeId, setAssigneeId] = useState<string>("all");
  const [status, setStatus] = useState<TaskStatus | "all">("all");
  const [priority, setPriority] = useState<TaskPriority | "all">("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sortBy, setSortBy] = useState<"created_at" | "due_date" | "priority" | "title" | "updated_at">("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [view, setView] = useState<"table" | "kanban">("table");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = useServerFn(listTasks);
  const stats = useServerFn(getTasksStats);
  const del = useServerFn(deleteTask);
  const arch = useServerFn(archiveTask);
  const rest = useServerFn(restoreTask);
  const comp = useServerFn(completeTask);
  const dup = useServerFn(duplicateTask);

  const projects = useQuery({
    enabled: !!org,
    queryKey: ["projects-opts", org?.id],
    queryFn: async (): Promise<Named[]> => {
      const { data, error } = await supabase.from("projects").select("id, name").eq("organization_id", org!.id).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const teams = useQuery({
    enabled: !!org,
    queryKey: ["teams-opts", org?.id],
    queryFn: async (): Promise<Named[]> => {
      const { data, error } = await supabase.from("teams").select("id, name").eq("organization_id", org!.id).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const departments = useQuery({
    enabled: !!org,
    queryKey: ["depts-opts", org?.id],
    queryFn: async (): Promise<Named[]> => {
      const { data, error } = await supabase.from("departments").select("id, name").eq("organization_id", org!.id).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const members = useQuery({
    enabled: !!org,
    queryKey: ["org-members-profiles", org?.id],
    queryFn: async (): Promise<Profile[]> => {
      const { data: mems, error } = await supabase.from("organization_members").select("user_id").eq("organization_id", org!.id);
      if (error) throw error;
      const ids = (mems ?? []).map((m) => m.user_id).filter(Boolean);
      if (!ids.length) return [];
      const { data: profs, error: pe } = await supabase.from("profiles").select("id, full_name, avatar_url").in("id", ids);
      if (pe) throw pe;
      return profs ?? [];
    },
  });

  const statsQ = useQuery({
    enabled: !!org,
    queryKey: ["tasks-stats", org?.id],
    queryFn: () => stats({ data: { organization_id: org!.id } }),
  });

  const q = useQuery({
    enabled: !!org,
    queryKey: [
      "tasks", org?.id, projectId, teamId, departmentId, assigneeId, status, priority,
      search, includeArchived, sortBy, sortDir, page,
    ],
    queryFn: () =>
      list({
        data: {
          organization_id: org!.id,
          project_id: projectId === "all" ? undefined : projectId,
          team_id: teamId === "all" ? undefined : teamId,
          department_id: departmentId === "all" ? undefined : departmentId,
          assignee_id: assigneeId === "all" ? undefined : assigneeId,
          status: status === "all" ? undefined : status,
          priority: priority === "all" ? undefined : priority,
          search: search || undefined,
          include_archived: includeArchived,
          sort_by: sortBy,
          sort_dir: sortDir,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      }),
  });

  const rows = (q.data?.rows ?? []) as TaskRow[];
  const total = q.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Kanban query: fetch all non-archived tasks for the current filter set (up to 500)
  const kanbanQ = useQuery({
    enabled: !!org && view === "kanban",
    queryKey: ["tasks-kanban", org?.id, projectId, teamId, departmentId, assigneeId, priority, search, includeArchived],
    queryFn: () =>
      list({
        data: {
          organization_id: org!.id,
          project_id: projectId === "all" ? undefined : projectId,
          team_id: teamId === "all" ? undefined : teamId,
          department_id: departmentId === "all" ? undefined : departmentId,
          assignee_id: assigneeId === "all" ? undefined : assigneeId,
          priority: priority === "all" ? undefined : priority,
          search: search || undefined,
          include_archived: includeArchived,
          sort_by: "updated_at",
          sort_dir: "desc",
          limit: 500,
          offset: 0,
        },
      }),
  });

  const profileMap = useMemo(() => {
    const m = new Map<string, Profile>();
    (members.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [members.data]);
  const projMap = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const teamMap = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t.name])), [teams.data]);
  const deptMap = useMemo(() => new Map((departments.data ?? []).map((d) => [d.id, d.name])), [departments.data]);

  const displayName = (id: string | null) => (id ? profileMap.get(id)?.full_name ?? "—" : "—");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks", org?.id] });
    qc.invalidateQueries({ queryKey: ["tasks-kanban", org?.id] });
    qc.invalidateQueries({ queryKey: ["tasks-stats", org?.id] });
  };

  const update = useServerFn(updateTask);

  const doMut = (fn: () => Promise<unknown>, msg: string) =>
    fn().then(() => { toast.success(msg); refresh(); }).catch((e: Error) => toast.error(e.message));

  const clearSelection = () => setSelected(new Set());

  const runBulk = async (label: string, fn: (id: string) => Promise<unknown>) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map(fn));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - ok;
    if (fail === 0) toast.success(`${label} ${ok} task${ok === 1 ? "" : "s"}`);
    else toast.warning(`${label} ${ok} of ${results.length} (${fail} failed)`);
    clearSelection();
    refresh();
  };


  const exportCsv = () => {
    const headers = ["Code", "Title", "Project", "Team", "Department", "Assignee", "Reporter", "Priority", "Status", "Progress", "Est. Hours", "Logged Hours", "Start", "Due", "Updated"];
    const lines = [headers.join(",")].concat(
      rows.map((t) =>
        [
          t.code ?? "", t.title, projMap.get(t.project_id) ?? "", t.team_id ? teamMap.get(t.team_id) ?? "" : "",
          t.department_id ? deptMap.get(t.department_id) ?? "" : "", displayName(t.assignee_id), displayName(t.reporter_id),
          t.priority, t.status, `${t.progress}%`, t.estimated_hours ?? "", t.logged_hours ?? 0,
          t.start_date ?? "", t.due_date ?? "", t.updated_at,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!org) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Select an organization to see its tasks.
      </div>
    );
  }

  const canManage = can(["team.manage_members", "org.update"]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">Plan, assign, and track work across {org.name}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border">
            <Button
              size="sm"
              variant={view === "table" ? "secondary" : "ghost"}
              className="rounded-none"
              onClick={() => setView("table")}
            >
              <ListIcon className="h-4 w-4" /> Table
            </Button>
            <Button
              size="sm"
              variant={view === "kanban" ? "secondary" : "ghost"}
              className="rounded-none"
              onClick={() => { clearSelection(); setView("kanban"); }}
            >
              <LayoutGrid className="h-4 w-4" /> Kanban
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={q.isFetching || kanbanQ.isFetching}>
            <RefreshCw className={`h-4 w-4 ${q.isFetching || kanbanQ.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button
            size="sm"
            onClick={() => { setEditing(null); setOpen(true); }}
            disabled={!projects.data?.length}
          >
            <Plus className="h-4 w-4" /> New task
          </Button>
        </div>
      </div>

      {selected.size > 0 && view === "table" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-primary/5 px-4 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Checkbox checked onCheckedChange={() => clearSelection()} />
            <span className="font-medium">{selected.size} selected</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => runBulk("Completed", (id) => comp({ data: { id } }))}>
              <CheckCircle2 className="h-4 w-4" /> Complete
            </Button>
            <Button size="sm" variant="outline" onClick={() => runBulk("Archived", (id) => arch({ data: { id } }))}>
              <Archive className="h-4 w-4" /> Archive
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selected.size} task{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
                  <AlertDialogDescription>Tasks will be soft-deleted and can be restored later.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => runBulk("Deleted", (id) => del({ data: { id } }))}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <X className="h-4 w-4" /> Clear
            </Button>
          </div>
        </div>
      )}

      <StatsCards s={statsQ.data} loading={statsQ.isLoading} />

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search tasks, code, description…"
                className="w-64 pl-8"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
            <FSelect label="Project" value={projectId} setValue={(v) => { setProjectId(v); setPage(0); }} options={projects.data ?? []} />
            <FSelect label="Team" value={teamId} setValue={(v) => { setTeamId(v); setPage(0); }} options={teams.data ?? []} />
            <FSelect label="Department" value={departmentId} setValue={(v) => { setDepartmentId(v); setPage(0); }} options={departments.data ?? []} />
            <Select value={assigneeId} onValueChange={(v) => { setAssigneeId(v); setPage(0); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                {(members.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name ?? "Unnamed"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v as TaskStatus | "all"); setPage(0); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => (<SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={(v) => { setPriority(v as TaskPriority | "all"); setPage(0); }}>
              <SelectTrigger className="w-32"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {PRIORITIES.map((p) => (<SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={`${sortBy}:${sortDir}`} onValueChange={(v) => { const [b, d] = v.split(":"); setSortBy(b as typeof sortBy); setSortDir(d as "asc" | "desc"); }}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Sort" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at:desc">Newest first</SelectItem>
                <SelectItem value="created_at:asc">Oldest first</SelectItem>
                <SelectItem value="due_date:asc">Due date ↑</SelectItem>
                <SelectItem value="due_date:desc">Due date ↓</SelectItem>
                <SelectItem value="priority:desc">Priority ↓</SelectItem>
                <SelectItem value="title:asc">Title A–Z</SelectItem>
                <SelectItem value="updated_at:desc">Recently updated</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="h-4 w-4" checked={includeArchived} onChange={(e) => { setIncludeArchived(e.target.checked); setPage(0); }} />
              Show archived
            </label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {view === "kanban" ? (
            kanbanQ.isLoading ? (
              <div className="p-4"><Skeleton className="h-96 w-full" /></div>
            ) : kanbanQ.isError ? (
              <div className="p-8 text-sm text-destructive">{(kanbanQ.error as Error).message}</div>
            ) : (
              <KanbanBoard
                tasks={((kanbanQ.data?.rows ?? []) as KanbanTask[])}
                orgId={org.id}
                memberName={displayName}
                onMove={(id, status) => doMut(() => update({ data: { id, status } }), "Task moved")}
                onRealtime={refresh}
              />
            )
          ) : q.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : q.isError ? (
            <div className="p-8 text-sm text-destructive">
              {(q.error as Error).message}
              <Button size="sm" variant="outline" className="ml-2" onClick={() => q.refetch()}>Retry</Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <ListChecks className="mx-auto mb-2 h-8 w-8 opacity-50" />
              No tasks match these filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                        onCheckedChange={(v) => {
                          const next = new Set(selected);
                          if (v) rows.forEach((r) => next.add(r.id));
                          else rows.forEach((r) => next.delete(r.id));
                          setSelected(next);
                        }}
                        aria-label="Select all on page"
                      />
                    </TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Dept.</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32">Progress</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => {
                    const overdue = t.due_date && t.status !== "done" && t.status !== "cancelled" && new Date(t.due_date) < new Date(new Date().toDateString());
                    return (
                      <TableRow key={t.id} className={t.archived_at ? "opacity-60" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(t.id)}
                            onCheckedChange={(v) => {
                              const next = new Set(selected);
                              if (v) next.add(t.id); else next.delete(t.id);
                              setSelected(next);
                            }}
                            aria-label={`Select task ${t.title}`}
                          />
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <Link to="/tasks/$taskId" params={{ taskId: t.id }} className="font-medium hover:underline">
                            {t.title}
                          </Link>
                          {t.labels && t.labels.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {t.labels.slice(0, 3).map((l) => <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{projMap.get(t.project_id) ?? "—"}</TableCell>
                        <TableCell className="text-xs">{t.team_id ? teamMap.get(t.team_id) ?? "—" : "—"}</TableCell>
                        <TableCell className="text-xs">{t.department_id ? deptMap.get(t.department_id) ?? "—" : "—"}</TableCell>
                        <TableCell className="text-xs">{displayName(t.assignee_id)}</TableCell>
                        <TableCell><Badge className={`capitalize ${priorityColor(t.priority)}`}>{t.priority}</Badge></TableCell>
                        <TableCell><Badge className={`capitalize ${statusColor(t.status)}`}>{t.status.replace("_", " ")}</Badge></TableCell>
                        <TableCell><Progress value={t.progress} className="h-2" /></TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{Number(t.logged_hours ?? 0).toFixed(1)}{t.estimated_hours ? ` / ${t.estimated_hours}` : ""}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{t.start_date ?? "—"}</TableCell>
                        <TableCell className={`text-xs whitespace-nowrap ${overdue ? "text-red-600 font-medium" : ""}`}>{t.due_date ?? "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(t.updated_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link to="/tasks/$taskId" params={{ taskId: t.id }}><Eye className="h-4 w-4" /> View</Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setEditing(t); setOpen(true); }}>
                                <Pencil className="h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              {t.status !== "done" && (
                                <DropdownMenuItem onClick={() => doMut(() => comp({ data: { id: t.id } }), "Task completed")}>
                                  <CheckCircle2 className="h-4 w-4" /> Mark complete
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => doMut(() => dup({ data: { id: t.id } }), "Task duplicated")}>
                                <Copy className="h-4 w-4" /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {t.archived_at ? (
                                <DropdownMenuItem onClick={() => doMut(() => rest({ data: { id: t.id } }), "Task restored")}>
                                  <ArchiveRestore className="h-4 w-4" /> Restore
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => doMut(() => arch({ data: { id: t.id } }), "Task archived")}>
                                  <Archive className="h-4 w-4" /> Archive
                                </DropdownMenuItem>
                              )}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                    <Trash2 className="h-4 w-4" /> Delete
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete "{t.title}"?</AlertDialogTitle>
                                    <AlertDialogDescription>This soft-deletes the task. You can restore it later from the archive filter.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => doMut(() => del({ data: { id: t.id } }), "Task deleted")}>Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t p-3">
              <p className="text-xs text-muted-foreground">
                Page {page + 1} of {pages} · {total} total
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        {open && (
          <TaskDialog
            key={editing?.id ?? "new"}
            orgId={org.id}
            task={editing}
            projects={projects.data ?? []}
            teams={teams.data ?? []}
            departments={departments.data ?? []}
            members={members.data ?? []}
            canManage={canManage}
            onDone={() => { setOpen(false); setEditing(null); refresh(); }}
          />
        )}
      </Dialog>
    </div>
  );
}

function FSelect({
  label, value, setValue, options,
}: { label: string; value: string; setValue: (v: string) => void; options: Named[] }) {
  return (
    <Select value={value} onValueChange={setValue}>
      <SelectTrigger className="w-40"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {label.toLowerCase()}s</SelectItem>
        {options.map((o) => (<SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>))}
      </SelectContent>
    </Select>
  );
}

function StatsCards({ s, loading }: { s: Record<string, number> | undefined; loading: boolean }) {
  const items = [
    { label: "Total", value: s?.total ?? 0, icon: ListChecks },
    { label: "Pending", value: s?.pending ?? 0, icon: Clock },
    { label: "In progress", value: s?.in_progress ?? 0, icon: TrendingUp },
    { label: "Completed", value: s?.completed ?? 0, icon: CheckCircle2 },
    { label: "Overdue", value: s?.overdue ?? 0, icon: AlertTriangle, danger: true },
    { label: "Blocked", value: s?.blocked ?? 0, icon: AlertTriangle },
    { label: "High priority", value: s?.high_priority ?? 0, icon: Flame },
    { label: "Due today", value: s?.due_today ?? 0, icon: CalendarClock },
    { label: "Due this week", value: s?.due_week ?? 0, icon: CalendarClock },
    { label: "Completion rate", value: `${s?.completion_rate ?? 0}%`, icon: TrendingUp },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="flex items-center justify-between gap-2 p-4">
            <div>
              <p className="text-xs text-muted-foreground">{it.label}</p>
              <p className={`mt-1 text-xl font-bold ${it.danger && Number(it.value) > 0 ? "text-red-600" : ""}`}>
                {loading ? <Skeleton className="h-6 w-10" /> : it.value}
              </p>
            </div>
            <it.icon className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TaskDialog({
  orgId, task, projects, teams, departments, members, canManage, onDone,
}: {
  orgId: string; task: TaskRow | null;
  projects: Named[]; teams: Named[]; departments: Named[]; members: Profile[];
  canManage: boolean; onDone: () => void;
}) {
  const create = useServerFn(createTask);
  const update = useServerFn(updateTask);
  const isEdit = !!task;

  const [title, setTitle] = useState(task?.title ?? "");
  const [code, setCode] = useState(task?.code ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [projectId, setProjectId] = useState<string>(task?.project_id ?? projects[0]?.id ?? "");
  const [teamId, setTeamId] = useState<string>(task?.team_id ?? "");
  const [departmentId, setDepartmentId] = useState<string>(task?.department_id ?? "");
  const [assigneeId, setAssigneeId] = useState<string>(task?.assignee_id ?? "");
  const [reporterId, setReporterId] = useState<string>(task?.reporter_id ?? "");
  const [status, setStatus] = useState<TaskStatus>((task?.status as TaskStatus) ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>((task?.priority as TaskPriority) ?? "medium");
  const [startDate, setStartDate] = useState(task?.start_date ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [estimated, setEstimated] = useState<string>(task?.estimated_hours != null ? String(task.estimated_hours) : "");
  const [labels, setLabels] = useState<string>((task?.labels ?? []).join(", "));
  const [progress, setProgress] = useState<number>(task?.progress ?? 0);

  const mut = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Task name is required");
      if (!projectId) throw new Error("Project is required");
      const labelsArr = labels.split(",").map((s) => s.trim()).filter(Boolean);
      const est = estimated ? Number(estimated) : null;
      if (isEdit) {
        return update({
          data: {
            id: task!.id, title, code: code || null, description: description || null,
            team_id: teamId || null, department_id: departmentId || null,
            assignee_id: assigneeId || null, reporter_id: reporterId || null,
            status, priority, start_date: startDate || null, due_date: dueDate || null,
            estimated_hours: est, labels: labelsArr, progress,
          },
        });
      }
      return create({
        data: {
          organization_id: orgId, project_id: projectId, title, code: code || null,
          description: description || null,
          team_id: teamId || null, department_id: departmentId || null,
          assignee_id: assigneeId || null, reporter_id: reporterId || null,
          status, priority, start_date: startDate || null, due_date: dueDate || null,
          estimated_hours: est, labels: labelsArr, progress,
        },
      });
    },
    onSuccess: () => { toast.success(isEdit ? "Task updated" : "Task created"); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit task" : "New task"}</DialogTitle>
        <DialogDescription>{isEdit ? "Update task details." : "Add a new task to a project."}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label htmlFor="t-title">Task name *</Label>
            <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="t-code">Task code</Label>
            <Input id="t-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ENG-101" />
          </div>
        </div>
        <div>
          <Label htmlFor="t-desc">Description</Label>
          <Textarea id="t-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Project *">
            <Select value={projectId} onValueChange={setProjectId} disabled={isEdit}>
              <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Team">
            <Select value={teamId || "none"} onValueChange={(v) => setTeamId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Team" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Department">
            <Select value={departmentId || "none"} onValueChange={(v) => setDepartmentId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assignee">
            <Select value={assigneeId || "none"} onValueChange={(v) => setAssigneeId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name ?? "Unnamed"}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Reporter">
            <Select value={reporterId || "none"} onValueChange={(v) => setReporterId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Reporter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Me</SelectItem>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name ?? "Unnamed"}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Start date">
            <Input type="date" value={startDate ?? ""} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate ?? ""} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Estimated hours">
            <Input type="number" min="0" step="0.25" value={estimated} onChange={(e) => setEstimated(e.target.value)} />
          </Field>
          <Field label="Progress (%)">
            <Input type="number" min="0" max="100" value={progress} onChange={(e) => setProgress(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
          </Field>
          <Field label="Labels (comma-separated)">
            <Input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="backend, urgent" />
          </Field>
        </div>
        {!canManage && (
          <p className="text-xs text-muted-foreground">Some fields may be read-only depending on your role.</p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? "Saving…" : isEdit ? "Save changes" : "Create task"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block">{label}</Label>
      {children}
    </div>
  );
}
