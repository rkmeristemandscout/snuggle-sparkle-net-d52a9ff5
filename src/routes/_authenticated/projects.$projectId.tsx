import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  getProject,
  updateProject,
  archiveProject,
  restoreProject,
  deleteProject,
  duplicateProject,
  listProjectMembers,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  listProjectFiles,
  recordProjectFile,
  deleteProjectFile,
  signProjectFile,
  listProjectDiscussions,
  createProjectDiscussion,
  updateProjectDiscussion,
  deleteProjectDiscussion,
  listFileShares,
  createFileShare,
  revokeFileShare,
  listDiscussionReactions,
  toggleDiscussionReaction,
} from "@/lib/projects.functions";
import { listTasks, createTask, updateTask, deleteTask } from "@/lib/tasks.functions";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Copy,
  Trash2,
  Loader2,
  Plus,
  Users,
  ListTodo,
  Activity as ActivityIcon,
  Settings as SettingsIcon,
  LayoutGrid,
  FileText,
  Calendar as CalendarIcon,
  MessageSquare,
  BarChart3,
  Upload,
  Download,
  Send,
  Reply,
  Pencil,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  component: ProjectDetailsPage,
  errorComponent: ({ error }) => (
    <div className="rounded-xl border bg-card p-6 text-sm text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="rounded-xl border bg-card p-6 text-sm">Project not found.</div>
  ),
});

const STATUSES = ["planning", "active", "on_hold", "completed", "archived"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
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

function ProjectDetailsPage() {
  const { projectId } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { currentMembership } = useCurrentOrg();

  const get = useServerFn(getProject);
  const arch = useServerFn(archiveProject);
  const rest = useServerFn(restoreProject);
  const del = useServerFn(deleteProject);
  const dup = useServerFn(duplicateProject);

  const q = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => get({ data: { id: projectId } }),
  });

  // Realtime refresh
  useEffect(() => {
    const ch = supabase
      .channel(`project:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_members", filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ["project-members", projectId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ["project-tasks", projectId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [projectId, qc]);

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-destructive">
        {(q.error as Error).message}
      </div>
    );
  }
  const p = q.data as any;
  if (!p) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button variant="ghost" size="sm" onClick={() => nav({ to: "/projects" })}>
          <ArrowLeft className="h-4 w-4" /> Back to projects
        </Button>
      </div>

      {/* Header */}
      <Card>
        {p.cover_image_url && (
          <div
            className="h-32 w-full rounded-t-xl bg-cover bg-center"
            style={{ backgroundImage: `url(${p.cover_image_url})` }}
          />
        )}
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <Avatar className="h-14 w-14 rounded-lg">
                <AvatarImage src={p.logo_url ?? undefined} />
                <AvatarFallback
                  className="rounded-lg font-semibold"
                  style={p.color ? { backgroundColor: p.color, color: "#fff" } : undefined}
                >
                  {p.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold md:text-2xl">{p.name}</h1>
                  {p.code && <Badge variant="outline" className="font-mono">{p.code}</Badge>}
                  <Badge className={`capitalize ${statusColor[p.status] ?? ""}`} variant="secondary">
                    {p.status.replace("_", " ")}
                  </Badge>
                  <Badge className={`capitalize ${priorityColor[p.priority] ?? ""}`} variant="secondary">
                    {p.priority}
                  </Badge>
                </div>
                {p.client && <p className="mt-1 text-sm text-muted-foreground">Client: {p.client}</p>}
                {p.description && <p className="mt-2 max-w-2xl text-sm">{p.description}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const r = await dup({ data: { id: p.id } });
                  toast.success("Duplicated");
                  nav({ to: "/projects/$projectId", params: { projectId: r.id } });
                }}
              >
                <Copy className="h-4 w-4" /> Duplicate
              </Button>
              {p.archived_at ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await rest({ data: { id: p.id } });
                    toast.success("Restored");
                    qc.invalidateQueries({ queryKey: ["project", projectId] });
                  }}
                >
                  <ArchiveRestore className="h-4 w-4" /> Restore
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await arch({ data: { id: p.id } });
                    toast.success("Archived");
                    qc.invalidateQueries({ queryKey: ["project", projectId] });
                  }}
                >
                  <Archive className="h-4 w-4" /> Archive
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive">
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {p.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This soft-deletes the project. You can restore it later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        await del({ data: { id: p.id } });
                        toast.success("Deleted");
                        nav({ to: "/projects" });
                      }}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetaBox label="Progress">
              <div className="flex items-center gap-2">
                <Progress value={p.progress} className="h-2 w-full" />
                <span className="text-xs text-muted-foreground">{p.progress}%</span>
              </div>
            </MetaBox>
            <MetaBox label="Budget">
              {p.budget != null ? `$${Number(p.budget).toLocaleString()}` : "—"}
            </MetaBox>
            <MetaBox label="Start date">
              {p.start_date ? new Date(p.start_date).toLocaleDateString() : "—"}
            </MetaBox>
            <MetaBox label="Due date">
              {p.due_date ? new Date(p.due_date).toLocaleDateString() : "—"}
            </MetaBox>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview"><LayoutGrid className="mr-1 h-4 w-4" />Overview</TabsTrigger>
          <TabsTrigger value="tasks"><ListTodo className="mr-1 h-4 w-4" />Tasks</TabsTrigger>
          <TabsTrigger value="team"><Users className="mr-1 h-4 w-4" />Team</TabsTrigger>
          <TabsTrigger value="files"><FileText className="mr-1 h-4 w-4" />Files</TabsTrigger>
          <TabsTrigger value="calendar"><CalendarIcon className="mr-1 h-4 w-4" />Calendar</TabsTrigger>
          <TabsTrigger value="activity"><ActivityIcon className="mr-1 h-4 w-4" />Activity</TabsTrigger>
          <TabsTrigger value="discussions"><MessageSquare className="mr-1 h-4 w-4" />Discussions</TabsTrigger>
          <TabsTrigger value="analytics"><BarChart3 className="mr-1 h-4 w-4" />Analytics</TabsTrigger>
          <TabsTrigger value="settings"><SettingsIcon className="mr-1 h-4 w-4" />Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab project={p} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <TasksTab projectId={projectId} orgId={p.organization_id} />
        </TabsContent>
        <TabsContent value="team" className="mt-4">
          <TeamTab projectId={projectId} orgId={p.organization_id} />
        </TabsContent>
        <TabsContent value="files" className="mt-4">
          <FilesTab projectId={projectId} orgId={p.organization_id} />
        </TabsContent>
        <TabsContent value="calendar" className="mt-4">
          <CalendarTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="discussions" className="mt-4">
          <DiscussionsTab projectId={projectId} orgId={p.organization_id} />
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          <AnalyticsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab project={p} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetaBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium">{children}</div>
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">
        {label} module is scoped for this project. Extend as needed.
      </CardContent>
    </Card>
  );
}

// ---------------- Overview ----------------
function OverviewTab({ project: p }: { project: any }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row k="Status" v={<span className="capitalize">{p.status.replace("_", " ")}</span>} />
          <Row k="Priority" v={<span className="capitalize">{p.priority}</span>} />
          <Row k="Client" v={p.client ?? "—"} />
          <Row k="Code" v={p.code ?? "—"} />
          <Row k="Created" v={new Date(p.created_at).toLocaleString()} />
          <Row k="Updated" v={new Date(p.updated_at).toLocaleString()} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Tags</CardTitle></CardHeader>
        <CardContent>
          {(p.tags ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No tags</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {p.tags.map((t: string) => (
                <Badge key={t} variant="secondary">{t}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b py-1 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}

// ---------------- Tasks ----------------
const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "blocked"] as const;
function TasksTab({ projectId, orgId }: { projectId: string; orgId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listTasks);
  const create = useServerFn(createTask);
  const upd = useServerFn(updateTask);
  const del = useServerFn(deleteTask);
  const [view, setView] = useState<"list" | "kanban">("list");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const q = useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: () => list({ data: { organization_id: orgId, project_id: projectId, limit: 200 } }),
  });
  const rows = (q.data?.rows ?? []) as any[];

  const createMut = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Title required");
      return create({
        data: {
          organization_id: orgId,
          project_id: projectId,
          title: title.trim(),
        },
      });
    },
    onSuccess: () => {
      setTitle("");
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Tasks</CardTitle>
          <Badge variant="secondary">{rows.length}</Badge>
        </div>
        <div className="flex gap-2">
          <Select value={view} onValueChange={(v) => setView(v as any)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="list">List</SelectItem>
              <SelectItem value="kanban">Kanban</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="h-4 w-4" /> New task
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {creating && (
          <div className="mb-4 flex gap-2">
            <Input
              placeholder="Task title…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createMut.mutate()}
            />
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </div>
        )}
        {q.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No tasks yet.</p>
        ) : view === "list" ? (
          <ul className="divide-y">
            {rows.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={t.status === "done"}
                    onChange={async () => {
                      await upd({
                        data: { id: t.id, status: t.status === "done" ? "todo" : "done" },
                      });
                      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
                    }}
                  />
                  <span className={t.status === "done" ? "line-through text-muted-foreground" : ""}>
                    {t.title}
                  </span>
                  <Badge variant="outline" className="capitalize">{t.status.replace("_", " ")}</Badge>
                  <Badge variant="secondary" className="capitalize">{t.priority}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Select
                    value={t.status}
                    onValueChange={async (v) => {
                      await upd({ data: { id: t.id, status: v as any } });
                      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
                    }}
                  >
                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">
                          {s.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await del({ data: { id: t.id } });
                      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {TASK_STATUSES.map((s) => (
              <div key={s} className="rounded-lg border bg-muted/30 p-2">
                <p className="mb-2 text-xs font-medium capitalize text-muted-foreground">
                  {s.replace("_", " ")} · {rows.filter((t) => t.status === s).length}
                </p>
                <div className="space-y-2">
                  {rows
                    .filter((t) => t.status === s)
                    .map((t) => (
                      <div key={t.id} className="rounded-md border bg-background p-2 text-sm">
                        {t.title}
                        <div className="mt-1">
                          <Badge variant="outline" className="capitalize text-[10px]">
                            {t.priority}
                          </Badge>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------- Team ----------------
function TeamTab({ projectId, orgId }: { projectId: string; orgId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listProjectMembers);
  const add = useServerFn(addProjectMember);
  const chRole = useServerFn(updateProjectMemberRole);
  const remove = useServerFn(removeProjectMember);
  const [selectedUser, setSelectedUser] = useState("");
  const [role, setRole] = useState<"manager" | "lead" | "member" | "viewer">("member");

  const q = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => list({ data: { project_id: projectId } }),
  });
  const orgMembersQ = useQuery({
    queryKey: ["org-members-lite", orgId],
    queryFn: async () => {
      const { data: mems } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", orgId);
      const ids = (mems ?? []).map((m) => m.user_id);
      if (!ids.length) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", ids);
      return profs ?? [];
    },
  });

  const rows = q.data ?? [];
  const existingIds = new Set(rows.map((r: any) => r.user_id));
  const available = (orgMembersQ.data ?? []).filter((m: any) => !existingIds.has(m.id));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Project members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select value={selectedUser} onValueChange={setSelectedUser}>
            <SelectTrigger className="min-w-[220px] flex-1">
              <SelectValue placeholder="Add a member…" />
            </SelectTrigger>
            <SelectContent>
              {available.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>{m.full_name ?? "Unnamed"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={(v) => setRole(v as any)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manager">Manager</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          <Button
            disabled={!selectedUser}
            onClick={async () => {
              try {
                await add({ data: { project_id: projectId, user_id: selectedUser, role } });
                setSelectedUser("");
                qc.invalidateQueries({ queryKey: ["project-members", projectId] });
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        {q.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No project members yet.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((m: any) => (
              <li key={m.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={m.profile?.avatar_url ?? undefined} />
                    <AvatarFallback className="text-xs">
                      {(m.profile?.full_name ?? "?").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{m.profile?.full_name ?? "Unnamed"}</p>
                    <p className="text-xs text-muted-foreground">{m.profile?.email ?? ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={m.role}
                    onValueChange={async (v) => {
                      await chRole({ data: { id: m.id, role: v as any } });
                      qc.invalidateQueries({ queryKey: ["project-members", projectId] });
                    }}
                  >
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="lead">Lead</SelectItem>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await remove({ data: { id: m.id } });
                      qc.invalidateQueries({ queryKey: ["project-members", projectId] });
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------- Calendar ----------------
function CalendarTab({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ["project-calendar", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("id, title, due_date, status")
        .eq("project_id", projectId)
        .not("due_date", "is", null)
        .order("due_date");
      return data ?? [];
    },
  });
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Upcoming deadlines</CardTitle></CardHeader>
      <CardContent>
        {!data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No dated tasks.</p>
        ) : (
          <ul className="divide-y">
            {data.map((t: any) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <span>{t.title}</span>
                <span className="text-muted-foreground">
                  {new Date(t.due_date).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------- Activity ----------------
function ActivityTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project-activity", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_logs")
        .select("*")
        .or(`entity_id.eq.${projectId},metadata->>project_id.eq.${projectId}`)
        .order("created_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Activity</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !data?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.map((a: any) => (
              <li key={a.id} className="rounded-md border p-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
                {a.entity_type && (
                  <p className="text-xs text-muted-foreground">{a.entity_type}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------- Analytics ----------------
function AnalyticsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["project-analytics", projectId],
    queryFn: async () => {
      const { data } = await supabase
        .from("tasks")
        .select("status, priority")
        .eq("project_id", projectId);
      return data ?? [];
    },
  });
  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    (data ?? []).forEach((t: any) => {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    });
    return { byStatus, byPriority, total: (data ?? []).length };
  }, [data]);
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Tasks by status</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {Object.entries(stats.byStatus).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="capitalize">{k.replace("_", " ")}</span>
              <span>{v}</span>
            </div>
          ))}
          {stats.total === 0 && <p className="text-muted-foreground">No data</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Tasks by priority</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {Object.entries(stats.byPriority).map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <span className="capitalize">{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {stats.total === 0 && <p className="text-muted-foreground">No data</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- Settings ----------------
function SettingsTab({ project }: { project: any }) {
  const qc = useQueryClient();
  const upd = useServerFn(updateProject);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState(project.status);
  const [priority, setPriority] = useState(project.priority);
  const [progress, setProgress] = useState(project.progress);

  const mut = useMutation({
    mutationFn: () =>
      upd({
        data: {
          id: project.id,
          name,
          description: description || null,
          status,
          priority,
          progress,
        },
      }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Project settings</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Description</Label>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label>Progress ({progress}%)</Label>
          <Input
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
          />
        </div>
        <div className="md:col-span-2">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------- Files ----------------
function FilesTab({ projectId, orgId }: { projectId: string; orgId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listProjectFiles);
  const record = useServerFn(recordProjectFile);
  const del = useServerFn(deleteProjectFile);
  const sign = useServerFn(signProjectFile);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; mime: string } | null>(null);

  const q = useQuery({
    queryKey: ["project-files", projectId],
    queryFn: () => list({ data: { project_id: projectId } }),
  });
  const inv = () => qc.invalidateQueries({ queryKey: ["project-files", projectId] });

  useEffect(() => {
    const ch = supabase
      .channel(`pfiles-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_files", filter: `project_id=eq.${projectId}` },
        inv,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const doUpload = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    setBusy(true);
    try {
      for (const file of arr) {
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 25MB`);
          continue;
        }
        const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const path = `${orgId}/${projectId}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage
          .from("project-files")
          .upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (error) throw error;
        await record({
          data: {
            project_id: projectId,
            organization_id: orgId,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type || "application/octet-stream",
            storage_path: path,
          },
        });
      }
      toast.success("Uploaded");
      inv();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const openPreview = async (row: any) => {
    try {
      const { url } = await sign({ data: { storage_path: row.storage_path, expires_in: 600 } });
      setPreview({ url, name: row.file_name, mime: row.mime_type });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const download = async (row: any) => {
    try {
      const { url } = await sign({ data: { storage_path: row.storage_path, expires_in: 300 } });
      const a = document.createElement("a");
      a.href = url;
      a.download = row.file_name;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (row: any) => {
    try {
      await del({ data: { id: row.id, storage_path: row.storage_path } });
      toast.success("Deleted");
      inv();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const rows = (q.data ?? []) as any[];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Files</CardTitle>
          <Badge variant="secondary">{rows.length}</Badge>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => e.target.files && doUpload(e.target.files)}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files);
          }}
          className={`mb-4 rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted-foreground transition ${
            dragOver ? "border-primary bg-primary/5" : ""
          }`}
        >
          Drag &amp; drop files here, or click Upload. Max 25MB per file.
        </div>
        {q.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files uploaded yet.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <button
                  type="button"
                  onClick={() => openPreview(f)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate font-medium hover:underline">{f.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {((f.file_size ?? 0) / 1024).toFixed(1)} KB · {f.mime_type} ·{" "}
                    {new Date(f.created_at).toLocaleString()}
                  </p>
                </button>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => download(f)} title="Download">
                    <Download className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {f.file_name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the file from storage.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(f)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="max-h-[70vh] overflow-auto">
              {preview.mime.startsWith("image/") ? (
                <img src={preview.url} alt={preview.name} className="mx-auto max-h-[65vh]" />
              ) : preview.mime.startsWith("video/") ? (
                <video src={preview.url} controls className="w-full" />
              ) : preview.mime.startsWith("audio/") ? (
                <audio src={preview.url} controls className="w-full" />
              ) : preview.mime === "application/pdf" ? (
                <iframe src={preview.url} title={preview.name} className="h-[65vh] w-full" />
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Preview not available for this file type.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => preview && window.open(preview.url, "_blank")}>
              Open in new tab
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------- Discussions ----------------
type DiscussionRow = {
  id: string;
  organization_id: string;
  project_id: string;
  parent_id: string | null;
  title: string | null;
  body: string;
  author_id: string | null;
  created_at: string;
  updated_at: string;
};

function DiscussionsTab({ projectId, orgId }: { projectId: string; orgId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listProjectDiscussions);
  const create = useServerFn(createProjectDiscussion);
  const upd = useServerFn(updateProjectDiscussion);
  const del = useServerFn(deleteProjectDiscussion);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editTitle, setEditTitle] = useState("");

  const q = useQuery({
    queryKey: ["project-disc", projectId],
    queryFn: () => list({ data: { project_id: projectId } }),
  });
  const inv = () => qc.invalidateQueries({ queryKey: ["project-disc", projectId] });

  useEffect(() => {
    const ch = supabase
      .channel(`pdisc-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_discussions", filter: `project_id=eq.${projectId}` },
        inv,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const rows = (q.data ?? []) as DiscussionRow[];
  const grouped = useMemo(() => {
    const threads = rows.filter((r) => !r.parent_id);
    const byParent = new Map<string, DiscussionRow[]>();
    rows.filter((r) => r.parent_id).forEach((r) => {
      const arr = byParent.get(r.parent_id!) ?? [];
      arr.push(r);
      byParent.set(r.parent_id!, arr);
    });
    return { threads, byParent };
  }, [rows]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!body.trim()) throw new Error("Message required");
      return create({
        data: {
          project_id: projectId,
          organization_id: orgId,
          title: title.trim() || null,
          body: body.trim(),
        },
      });
    },
    onSuccess: () => {
      setTitle("");
      setBody("");
      toast.success("Discussion posted");
      inv();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const replyMut = useMutation({
    mutationFn: async (parentId: string) => {
      if (!replyBody.trim()) throw new Error("Reply required");
      return create({
        data: {
          project_id: projectId,
          organization_id: orgId,
          parent_id: parentId,
          body: replyBody.trim(),
        },
      });
    },
    onSuccess: () => {
      setReplyTo(null);
      setReplyBody("");
      inv();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await upd({ data: { id: editing, title: editTitle || null, body: editBody } });
      setEditing(null);
      toast.success("Updated");
      inv();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Start a discussion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder="Write a message…"
            value={body}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Post
            </Button>
          </div>
        </CardContent>
      </Card>

      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : grouped.threads.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No discussions yet. Start the first one above.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.threads.map((t) => {
            const replies = grouped.byParent.get(t.id) ?? [];
            return (
              <Card key={t.id}>
                <CardContent className="p-4">
                  <DiscussionBlock
                    row={t}
                    isEditing={editing === t.id}
                    editTitle={editTitle}
                    editBody={editBody}
                    onEdit={() => {
                      setEditing(t.id);
                      setEditTitle(t.title ?? "");
                      setEditBody(t.body);
                    }}
                    onCancelEdit={() => setEditing(null)}
                    onChangeTitle={setEditTitle}
                    onChangeBody={setEditBody}
                    onSaveEdit={saveEdit}
                    onDelete={async () => {
                      await del({ data: { id: t.id } });
                      inv();
                    }}
                    onReply={() => {
                      setReplyTo(t.id);
                      setReplyBody("");
                    }}
                    showTitle
                  />

                  {replies.length > 0 && (
                    <div className="mt-3 space-y-3 border-l-2 pl-4">
                      {replies.map((r) => (
                        <DiscussionBlock
                          key={r.id}
                          row={r}
                          isEditing={editing === r.id}
                          editTitle=""
                          editBody={editBody}
                          onEdit={() => {
                            setEditing(r.id);
                            setEditBody(r.body);
                          }}
                          onCancelEdit={() => setEditing(null)}
                          onChangeTitle={() => {}}
                          onChangeBody={setEditBody}
                          onSaveEdit={saveEdit}
                          onDelete={async () => {
                            await del({ data: { id: r.id } });
                            inv();
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {replyTo === t.id && (
                    <div className="mt-3 space-y-2 rounded-md border bg-muted/20 p-3">
                      <Textarea
                        placeholder="Write a reply…"
                        value={replyBody}
                        rows={2}
                        onChange={(e) => setReplyBody(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => replyMut.mutate(t.id)}
                          disabled={replyMut.isPending}
                        >
                          {replyMut.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          Reply
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DiscussionBlock({
  row,
  isEditing,
  editTitle,
  editBody,
  showTitle,
  onEdit,
  onCancelEdit,
  onChangeTitle,
  onChangeBody,
  onSaveEdit,
  onDelete,
  onReply,
}: {
  row: DiscussionRow;
  isEditing: boolean;
  editTitle: string;
  editBody: string;
  showTitle?: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onChangeTitle: (v: string) => void;
  onChangeBody: (v: string) => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onReply?: () => void;
}) {
  if (isEditing) {
    return (
      <div className="space-y-2">
        {showTitle && (
          <Input
            placeholder="Title"
            value={editTitle}
            onChange={(e) => onChangeTitle(e.target.value)}
          />
        )}
        <Textarea value={editBody} rows={3} onChange={(e) => onChangeBody(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancelEdit}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSaveEdit}>
            Save
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div>
      {showTitle && row.title && (
        <h3 className="mb-1 text-base font-semibold">{row.title}</h3>
      )}
      <p className="whitespace-pre-wrap text-sm">{row.body}</p>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {new Date(row.created_at).toLocaleString()}
          {row.updated_at !== row.created_at && " · edited"}
        </span>
        <div className="flex gap-1">
          {onReply && (
            <Button size="sm" variant="ghost" onClick={onReply}>
              <Reply className="h-3.5 w-3.5" /> Reply
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this post?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the post{row.parent_id ? "" : " and its replies"}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
