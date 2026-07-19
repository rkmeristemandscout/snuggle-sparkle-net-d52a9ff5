import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listTasks, createTask, updateTask, deleteTask } from "@/lib/tasks.functions";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2, Plus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: TasksPage,
});

const STATUSES = ["todo", "in_progress", "in_review", "done", "cancelled"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type TaskStatus = (typeof STATUSES)[number];
type TaskPriority = (typeof PRIORITIES)[number];

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  created_at: string;
};

type ProjectOpt = { id: string; name: string };

const PAGE_SIZE = 25;

function TasksPage() {
  const { currentMembership } = useCurrentOrg();
  const org = currentMembership?.organization;
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState<string>("all");
  const [status, setStatus] = useState<TaskStatus | "all">("all");
  const [priority, setPriority] = useState<TaskPriority | "all">("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);

  const list = useServerFn(listTasks);
  const del = useServerFn(deleteTask);

  const projects = useQuery({
    enabled: !!org,
    queryKey: ["projects-options", org?.id],
    queryFn: async (): Promise<ProjectOpt[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .eq("organization_id", org!.id)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const q = useQuery({
    enabled: !!org,
    queryKey: ["tasks", org?.id, projectId, status, priority, search, page],
    queryFn: () =>
      list({
        data: {
          organization_id: org!.id,
          project_id: projectId === "all" ? undefined : projectId,
          status: status === "all" ? undefined : status,
          priority: priority === "all" ? undefined : priority,
          search: search || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      }),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Task deleted");
      qc.invalidateQueries({ queryKey: ["tasks", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (q.data?.rows ?? []) as TaskRow[];
  const total = q.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? "—";

  if (!org) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Select an organization to see its tasks.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track and assign tasks.</p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setEditing(null);
          }}
        >
          <DialogTrigger asChild>
            <Button
              disabled={!projects.data?.length}
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New task
            </Button>
          </DialogTrigger>
          <TaskDialog
            key={editing?.id ?? "new"}
            orgId={org.id}
            task={editing}
            projects={projects.data ?? []}
            onDone={() => {
              setOpen(false);
              setEditing(null);
              qc.invalidateQueries({ queryKey: ["tasks", org.id] });
            }}
          />
        </Dialog>
      </div>

      {!projects.data?.length && !projects.isLoading && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          Create a project first to start adding tasks.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search tasks…"
          className="max-w-xs"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <Select
          value={projectId}
          onValueChange={(v) => {
            setProjectId(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(projects.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as TaskStatus | "all");
            setPage(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={priority}
          onValueChange={(v) => {
            setPriority(v as TaskPriority | "all");
            setPage(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {total} task{total === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>All tasks in {org.name}.</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…
            </div>
          ) : q.isError ? (
            <div className="py-8 text-sm text-destructive">
              {(q.error as Error).message}
              <Button size="sm" variant="outline" className="ml-2" onClick={() => q.refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No tasks found.</div>
          ) : (
            <ul className="divide-y">
              {rows.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{t.title}</p>
                      <Badge variant="secondary" className="capitalize">
                        {t.status.replace("_", " ")}
                      </Badge>
                      <Badge variant="outline" className="capitalize">
                        {t.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {projectName(t.project_id)}
                      {t.due_date ? ` · due ${new Date(t.due_date).toLocaleDateString()}` : ""}
                    </p>
                    {t.description && (
                      <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                        {t.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Edit"
                      onClick={() => {
                        setEditing(t);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="icon" variant="ghost" aria-label="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete task?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes "{t.title}".
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => delMut.mutate(t.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Page {page + 1} of {pages}
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
    </div>
  );
}

function TaskDialog({
  orgId,
  task,
  projects,
  onDone,
}: {
  orgId: string;
  task: TaskRow | null;
  projects: ProjectOpt[];
  onDone: () => void;
}) {
  const create = useServerFn(createTask);
  const update = useServerFn(updateTask);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [projectId, setProjectId] = useState<string>(task?.project_id ?? projects[0]?.id ?? "");
  const [status, setStatus] = useState<TaskStatus>((task?.status as TaskStatus) ?? "todo");
  const [priority, setPriority] = useState<TaskPriority>(
    (task?.priority as TaskPriority) ?? "medium",
  );
  const [dueDate, setDueDate] = useState(task?.due_date?.slice(0, 10) ?? "");

  const isEdit = !!task;

  const mut = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Title is required");
      if (!projectId) throw new Error("Project is required");
      if (isEdit) {
        return update({
          data: {
            id: task!.id,
            title,
            description: description || null,
            status,
            priority,
            due_date: dueDate || null,
          },
        });
      }
      return create({
        data: {
          organization_id: orgId,
          project_id: projectId,
          title,
          description: description || null,
          status,
          priority,
          due_date: dueDate || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? "Task updated" : "Task created");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit task" : "New task"}</DialogTitle>
        <DialogDescription>
          {isEdit ? "Update task details." : "Add a new task to a project."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label htmlFor="t-title">Title</Label>
          <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="t-desc">Description</Label>
          <Textarea
            id="t-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={isEdit}>
              <SelectTrigger>
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="t-due">Due date</Label>
            <Input
              id="t-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? "Saving…" : isEdit ? "Save changes" : "Create task"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
