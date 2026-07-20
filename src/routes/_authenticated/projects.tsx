import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  restoreProject,
  duplicateProject,
  getProjectsStats,
} from "@/lib/projects.functions";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Loader2,
  RefreshCw,
  Download,
  MoreHorizontal,
  Eye,
  Pencil,
  Copy,
  Archive,
  ArchiveRestore,
  Trash2,
  FolderKanban,
  CheckCircle2,
  Clock,
  DollarSign,
  Search as SearchIcon,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsPage,
});

const STATUSES = ["planning", "active", "on_hold", "completed", "archived"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type Status = (typeof STATUSES)[number];
type Priority = (typeof PRIORITIES)[number];

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  code: string | null;
  description: string | null;
  client: string | null;
  status: string;
  priority: string;
  progress: number;
  color: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  budget: number | null;
  tags: string[];
  start_date: string | null;
  due_date: string | null;
  team_id: string | null;
  department_id: string | null;
  manager_id: string | null;
  owner_id: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

const PAGE_SIZE = 20;

const priorityColor: Record<string, string> = {
  low: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  medium: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  urgent: "bg-red-500/15 text-red-600 dark:text-red-300",
};
const statusColor: Record<string, string> = {
  planning: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  on_hold: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  completed: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  archived: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
};

function ProjectsPage() {
  const { currentMembership } = useCurrentOrg();
  const org = currentMembership?.organization;
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [deptId, setDeptId] = useState<string>("all");
  const [managerId, setManagerId] = useState<string>("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState<"created_at" | "updated_at" | "name" | "due_date" | "priority" | "status" | "progress">("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const list = useServerFn(listProjects);
  const stats = useServerFn(getProjectsStats);
  const del = useServerFn(deleteProject);
  const archive = useServerFn(archiveProject);
  const restore = useServerFn(restoreProject);
  const dup = useServerFn(duplicateProject);

  const q = useQuery({
    enabled: !!org,
    queryKey: ["projects", org?.id, search, status, priority, deptId, managerId, includeArchived, sort, order, page],
    queryFn: () =>
      list({
        data: {
          organization_id: org!.id,
          search: search || undefined,
          status: status === "all" ? undefined : status,
          priority: priority === "all" ? undefined : priority,
          department_id: deptId === "all" ? undefined : deptId,
          manager_id: managerId === "all" ? undefined : managerId,
          include_archived: includeArchived,
          sort,
          order,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      }),
  });

  const statsQ = useQuery({
    enabled: !!org,
    queryKey: ["projects-stats", org?.id],
    queryFn: () => stats({ data: { organization_id: org!.id } }),
  });

  const deptsQ = useQuery({
    enabled: !!org,
    queryKey: ["orgs-departments-lite", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name")
        .eq("organization_id", org!.id)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const teamsQ = useQuery({
    enabled: !!org,
    queryKey: ["orgs-teams-lite", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("organization_id", org!.id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const membersQ = useQuery({
    enabled: !!org,
    queryKey: ["org-members-lite", org?.id],
    queryFn: async () => {
      const { data: mems, error } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", org!.id);
      if (error) throw error;
      const ids = (mems ?? []).map((m) => m.user_id);
      if (!ids.length) return [] as { id: string; full_name: string | null; avatar_url: string | null }[];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", ids);
      return profs ?? [];
    },
  });

  const rows = (q.data?.rows ?? []) as ProjectRow[];
  const total = q.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const deptMap = useMemo(
    () => new Map((deptsQ.data ?? []).map((d) => [d.id, d.name])),
    [deptsQ.data],
  );
  const teamMap = useMemo(
    () => new Map((teamsQ.data ?? []).map((t) => [t.id, t.name])),
    [teamsQ.data],
  );
  const memberMap = useMemo(
    () => new Map((membersQ.data ?? []).map((m) => [m.id, m])),
    [membersQ.data],
  );

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["projects", org?.id] });
    qc.invalidateQueries({ queryKey: ["projects-stats", org?.id] });
    toast.success("Refreshed");
  };

  const exportCSV = async () => {
    if (!org || isExporting) return;
    setIsExporting(true);
    const toastId = toast.loading("Preparing CSV export…");
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error("You must be signed in to export projects.");

      const BATCH = 500;
      let offset = 0;
      const all: ProjectRow[] = [];
      // Paginate all projects for the current org (RLS-enforced server-side).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await list({
          data: {
            organization_id: org.id,
            search: search || undefined,
            status: status === "all" ? undefined : status,
            priority: priority === "all" ? undefined : priority,
            department_id: deptId === "all" ? undefined : deptId,
            manager_id: managerId === "all" ? undefined : managerId,
            include_archived: includeArchived,
            sort,
            order,
            limit: BATCH,
            offset,
          },
        });
        const batch = (res?.rows ?? []) as ProjectRow[];
        all.push(...batch);
        if (batch.length < BATCH) break;
        offset += BATCH;
        if (all.length >= 50000) break; // safety cap
      }

      if (!all.length) {
        toast.dismiss(toastId);
        toast.info("No projects to export.");
        return;
      }

      const fmtDate = (v: string | null | undefined) => {
        if (!v) return "";
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return "";
        return d.toISOString().slice(0, 10);
      };
      const fmtDateTime = (v: string | null | undefined) => {
        if (!v) return "";
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";
      };
      const escape = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };

      const headers = [
        "Project Name",
        "Project Key",
        "Description",
        "Status",
        "Priority",
        "Owner",
        "Team",
        "Department",
        "Start Date",
        "Due Date",
        "Progress (%)",
        "Created At",
        "Updated At",
      ];

      const lines = [headers.map(escape).join(",")];
      for (const r of all) {
        lines.push(
          [
            r.name,
            r.code ?? "",
            r.description ?? "",
            r.status,
            r.priority,
            memberMap.get(r.owner_id ?? "")?.full_name ??
              memberMap.get(r.manager_id ?? "")?.full_name ??
              "",
            teamMap.get(r.team_id ?? "") ?? "",
            deptMap.get(r.department_id ?? "") ?? "",
            fmtDate(r.start_date),
            fmtDate(r.due_date),
            r.progress ?? 0,
            fmtDateTime(r.created_at),
            fmtDateTime(r.updated_at),
          ]
            .map(escape)
            .join(","),
        );
      }
      // UTF-8 BOM for Excel compatibility
      const csv = "\ufeff" + lines.join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (org.slug || org.name || "workspace")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "workspace";
      a.download = `projects-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.dismiss(toastId);
      toast.success(`Exported ${all.length} project${all.length === 1 ? "" : "s"}`);
    } catch (err) {
      console.error("[projects] CSV export failed", err);
      toast.dismiss(toastId);
      toast.error(err instanceof Error ? err.message : "Failed to export CSV");
    } finally {
      setIsExporting(false);
    }
  };

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Project deleted");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const archMut = useMutation({
    mutationFn: (id: string) => archive({ data: { id } }),
    onSuccess: () => {
      toast.success("Project archived");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const restMut = useMutation({
    mutationFn: (id: string) => restore({ data: { id } }),
    onSuccess: () => {
      toast.success("Project restored");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const dupMut = useMutation({
    mutationFn: (id: string) => dup({ data: { id } }),
    onSuccess: () => {
      toast.success("Project duplicated");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!org) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Select an organization to see its projects.
      </div>
    );
  }

  const s = statsQ.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan, track and deliver work across {org.name}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={q.isFetching}>
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!rows.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> New project
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          icon={<FolderKanban className="h-4 w-4" />}
          label="Total"
          value={s?.total ?? "—"}
          loading={statsQ.isLoading}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Active"
          value={s?.by_status.active ?? "—"}
          loading={statsQ.isLoading}
        />
        <StatCard
          icon={<Clock className="h-4 w-4 text-amber-500" />}
          label="On hold"
          value={s?.by_status.on_hold ?? "—"}
          loading={statsQ.isLoading}
        />
        <StatCard
          icon={<Archive className="h-4 w-4 text-slate-500" />}
          label="Archived"
          value={s?.archived ?? "—"}
          loading={statsQ.isLoading}
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4 text-blue-500" />}
          label="Total budget"
          value={s ? `$${Math.round(Number(s.total_budget)).toLocaleString()}` : "—"}
          loading={statsQ.isLoading}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="relative min-w-[200px] flex-1">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, code, client…"
              className="pl-8"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <FilterSelect
            value={status}
            onChange={(v) => {
              setStatus(v as any);
              setPage(0);
            }}
            options={[["all", "All statuses"], ...STATUSES.map((s) => [s, s.replace("_", " ")])]}
          />
          <FilterSelect
            value={priority}
            onChange={(v) => {
              setPriority(v as any);
              setPage(0);
            }}
            options={[["all", "All priorities"], ...PRIORITIES.map((p) => [p, p])]}
          />
          <FilterSelect
            value={deptId}
            onChange={(v) => {
              setDeptId(v);
              setPage(0);
            }}
            options={[["all", "All departments"], ...(deptsQ.data ?? []).map((d) => [d.id, d.name] as [string, string])]}
          />
          <FilterSelect
            value={managerId}
            onChange={(v) => {
              setManagerId(v);
              setPage(0);
            }}
            options={[["all", "All managers"], ...(membersQ.data ?? []).map((m) => [m.id, m.full_name ?? "Unnamed"] as [string, string])]}
          />
          <FilterSelect
            value={`${sort}:${order}`}
            onChange={(v) => {
              const [s2, o2] = v.split(":");
              setSort(s2 as any);
              setOrder(o2 as any);
            }}
            options={[
              ["created_at:desc", "Newest"],
              ["created_at:asc", "Oldest"],
              ["updated_at:desc", "Recently updated"],
              ["name:asc", "Name A–Z"],
              ["due_date:asc", "Due date ↑"],
              ["progress:desc", "Most progress"],
              ["priority:desc", "Priority"],
            ]}
          />
          <Button
            variant={includeArchived ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setIncludeArchived((v) => !v);
              setPage(0);
            }}
          >
            {includeArchived ? "Hiding none" : "Show archived"}
          </Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {total} project{total === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>All projects in {org.name}.</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : q.isError ? (
            <div className="py-8 text-sm text-destructive">
              {(q.error as Error).message}
              <Button size="sm" variant="outline" className="ml-2" onClick={() => q.refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <FolderKanban className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No projects yet. Create your first one to get started.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> New project
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Project</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="min-w-[140px]">Progress</TableHead>
                    <TableHead>Budget</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => {
                    const mgr = p.manager_id ? memberMap.get(p.manager_id) : null;
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 rounded-md">
                              <AvatarImage src={p.logo_url ?? undefined} />
                              <AvatarFallback
                                className="rounded-md text-xs font-semibold"
                                style={p.color ? { backgroundColor: p.color, color: "#fff" } : undefined}
                              >
                                {p.name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <Link
                                to="/projects/$projectId"
                                params={{ projectId: p.id }}
                                className="truncate font-medium hover:underline"
                              >
                                {p.name}
                              </Link>
                              {p.description && (
                                <p className="line-clamp-1 text-xs text-muted-foreground">
                                  {p.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {p.code ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">{p.client ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {deptMap.get(p.department_id ?? "") ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {teamMap.get(p.team_id ?? "") ?? "—"}
                        </TableCell>
                        <TableCell>
                          {mgr ? (
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={mgr.avatar_url ?? undefined} />
                                <AvatarFallback className="text-[10px]">
                                  {(mgr.full_name ?? "?").slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate text-sm">{mgr.full_name ?? "Unnamed"}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={`capitalize ${priorityColor[p.priority] ?? ""}`} variant="secondary">
                            {p.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={`capitalize ${statusColor[p.status] ?? ""}`} variant="secondary">
                            {p.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={p.progress} className="h-2 w-20" />
                            <span className="text-xs text-muted-foreground">{p.progress}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.budget != null ? `$${Number(p.budget).toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.due_date ? new Date(p.due_date).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <RowActions
                            project={p}
                            onEdit={() => {
                              setEditing(p);
                              setOpen(true);
                            }}
                            onDuplicate={() => dupMut.mutate(p.id)}
                            onArchive={() => archMut.mutate(p.id)}
                            onRestore={() => restMut.mutate(p.id)}
                            onDelete={() => delMut.mutate(p.id)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Page {page + 1} of {pages} · {total} total
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setEditing(null);
        }}
      >
        <ProjectDialog
          key={editing?.id ?? "new"}
          orgId={org.id}
          project={editing}
          departments={deptsQ.data ?? []}
          teams={teamsQ.data ?? []}
          members={membersQ.data ?? []}
          onDone={() => {
            setOpen(false);
            setEditing(null);
            refreshAll();
          }}
        />
      </Dialog>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          {icon}
        </div>
        <div className="mt-1 text-2xl font-semibold">
          {loading ? <Skeleton className="h-7 w-16" /> : value}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][] | string[][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[170px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v} className="capitalize">
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RowActions({
  project,
  onEdit,
  onDuplicate,
  onArchive,
  onRestore,
  onDelete,
}: {
  project: ProjectRow;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link to="/projects/$projectId" params={{ projectId: project.id }}>
            <Eye className="mr-2 h-4 w-4" /> View
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="mr-2 h-4 w-4" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDuplicate}>
          <Copy className="mr-2 h-4 w-4" /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {project.archived_at ? (
          <DropdownMenuItem onClick={onRestore}>
            <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="mr-2 h-4 w-4" /> Archive
          </DropdownMenuItem>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {project.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This soft-deletes the project. You can restore it later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#64748b"];

function ProjectDialog({
  orgId,
  project,
  departments,
  teams,
  members,
  onDone,
}: {
  orgId: string;
  project: ProjectRow | null;
  departments: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  members: { id: string; full_name: string | null; avatar_url: string | null }[];
  onDone: () => void;
}) {
  const create = useServerFn(createProject);
  const update = useServerFn(updateProject);
  const isEdit = !!project;

  const [name, setName] = useState(project?.name ?? "");
  const [code, setCode] = useState(project?.code ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [client, setClient] = useState(project?.client ?? "");
  const [departmentId, setDepartmentId] = useState(project?.department_id ?? "");
  const [teamId, setTeamId] = useState(project?.team_id ?? "");
  const [managerId, setManagerId] = useState(project?.manager_id ?? "");
  const [status, setStatus] = useState<Status>((project?.status as Status) ?? "planning");
  const [priority, setPriority] = useState<Priority>((project?.priority as Priority) ?? "medium");
  const [startDate, setStartDate] = useState(project?.start_date?.slice(0, 10) ?? "");
  const [dueDate, setDueDate] = useState(project?.due_date?.slice(0, 10) ?? "");
  const [budget, setBudget] = useState<string>(project?.budget != null ? String(project.budget) : "");
  const [tags, setTags] = useState<string>((project?.tags ?? []).join(", "));
  const [color, setColor] = useState(project?.color ?? COLORS[0]);
  const [coverUrl, setCoverUrl] = useState(project?.cover_image_url ?? "");
  const [progress, setProgress] = useState<number>(project?.progress ?? 0);

  const mut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Project name is required");
      const payload = {
        name: name.trim(),
        code: code.trim() || null,
        description: description || null,
        client: client || null,
        department_id: departmentId || null,
        team_id: teamId || null,
        manager_id: managerId || null,
        status,
        priority,
        start_date: startDate || null,
        due_date: dueDate || null,
        budget: budget ? Number(budget) : null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        color,
        cover_image_url: coverUrl || null,
      };
      if (isEdit) {
        return update({ data: { id: project!.id, ...payload, progress } });
      }
      return create({ data: { organization_id: orgId, ...payload } });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Project updated" : "Project created");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit project" : "Create project"}</DialogTitle>
        <DialogDescription>
          {isEdit ? "Update project details." : "Add a new project to this workspace."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Website redesign" />
        </div>
        <div>
          <Label>Code</Label>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WEB-2026" />
        </div>
        <div>
          <Label>Client</Label>
          <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Acme Inc." />
        </div>
        <div className="sm:col-span-2">
          <Label>Description</Label>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <Label>Department</Label>
          <Select value={departmentId || "none"} onValueChange={(v) => setDepartmentId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Team</Label>
          <Select value={teamId || "none"} onValueChange={(v) => setTeamId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Project manager</Label>
          <Select value={managerId || "none"} onValueChange={(v) => setManagerId(v === "none" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.full_name ?? "Unnamed"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Start date</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <Label>Due date</Label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div>
          <Label>Budget (USD)</Label>
          <Input type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        {isEdit && (
          <div>
            <Label>Progress ({progress}%)</Label>
            <Input
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <Label>Tags (comma separated)</Label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="design, q1, priority" />
        </div>
        <div className="sm:col-span-2">
          <Label>Cover image URL</Label>
          <Input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div className="sm:col-span-2">
          <Label>Color</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Pick color ${c}`}
                className={`h-7 w-7 rounded-full border-2 transition ${color === c ? "border-foreground scale-110" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? "Save changes" : "Create project"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
