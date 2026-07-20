import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  getTask, updateTask, completeTask, archiveTask, restoreTask, duplicateTask, deleteTask,
  listChecklist, addChecklistItem, updateChecklistItem, deleteChecklistItem,
  listComments, addComment, updateComment, deleteComment,
  listAttachments, recordAttachment, deleteAttachment, signTaskAttachment,
  listTimeEntries, startTimer, stopTimer, addManualTime, deleteTimeEntry,
} from "@/lib/tasks.functions";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { getCachedSignedUrl } from "@/lib/signed-url-cache";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, CheckCircle2, Archive, ArchiveRestore, Copy, Trash2, Play, Square,
  Paperclip, Download, MessageSquare, ListChecks, Clock, Activity as ActivityIcon,
  History, Upload,
} from "lucide-react";
import { MentionTextarea } from "@/components/tasks/mention-textarea";
import { MentionContent } from "@/components/tasks/mention-content";

export const Route = createFileRoute("/_authenticated/tasks/$taskId")({ component: TaskDetail });

type TaskRow = {
  id: string; organization_id: string; project_id: string; title: string; code: string | null;
  description: string | null; status: string; priority: string; progress: number;
  estimated_hours: number | null; logged_hours: number;
  start_date: string | null; due_date: string | null; labels: string[] | null;
  assignee_id: string | null; reporter_id: string | null;
  archived_at: string | null; deleted_at: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
};

function TaskDetail() {
  const { taskId } = useParams({ from: "/_authenticated/tasks/$taskId" });
  const { currentMembership } = useCurrentOrg();
  const org = currentMembership?.organization;
  const qc = useQueryClient();
  const getT = useServerFn(getTask);
  const comp = useServerFn(completeTask);
  const arch = useServerFn(archiveTask);
  const rest = useServerFn(restoreTask);
  const dup = useServerFn(duplicateTask);
  const del = useServerFn(deleteTask);

  const q = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => getT({ data: { id: taskId } }),
  });

  useEffect(() => {
    if (!org) return;
    const ch = supabase
      .channel(`task-${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `id=eq.${taskId}` }, () => qc.invalidateQueries({ queryKey: ["task", taskId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [taskId, org, qc]);

  const task = q.data as TaskRow | undefined;

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!task) return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Task not found.</div>;

  const doMut = (fn: () => Promise<unknown>, msg: string) =>
    fn().then(() => { toast.success(msg); qc.invalidateQueries({ queryKey: ["task", taskId] }); }).catch((e: Error) => toast.error(e.message));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/tasks" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
            <ArrowLeft className="h-4 w-4" /> All tasks
          </Link>
          <div className="flex items-center gap-2">
            {task.code && <Badge variant="outline" className="font-mono">{task.code}</Badge>}
            <h1 className="text-xl font-bold md:text-2xl">{task.title}</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className="capitalize">{task.status.replace("_", " ")}</Badge>
            <Badge variant="secondary" className="capitalize">{task.priority}</Badge>
            {task.due_date && <Badge variant="outline">Due {task.due_date}</Badge>}
            {task.archived_at && <Badge variant="outline">Archived</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {task.status !== "done" && (
            <Button size="sm" onClick={() => doMut(() => comp({ data: { id: task.id } }), "Task completed")}>
              <CheckCircle2 className="h-4 w-4" /> Complete
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => doMut(() => dup({ data: { id: task.id } }), "Task duplicated")}>
            <Copy className="h-4 w-4" /> Duplicate
          </Button>
          {task.archived_at ? (
            <Button size="sm" variant="outline" onClick={() => doMut(() => rest({ data: { id: task.id } }), "Task restored")}>
              <ArchiveRestore className="h-4 w-4" /> Restore
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => doMut(() => arch({ data: { id: task.id } }), "Task archived")}>
              <Archive className="h-4 w-4" /> Archive
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive"><Trash2 className="h-4 w-4" /> Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete task?</AlertDialogTitle>
                <AlertDialogDescription>This soft-deletes the task.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => doMut(() => del({ data: { id: task.id } }), "Task deleted")}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview"><ListChecks className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="checklist"><ListChecks className="h-4 w-4" /> Checklist</TabsTrigger>
          <TabsTrigger value="comments"><MessageSquare className="h-4 w-4" /> Comments</TabsTrigger>
          <TabsTrigger value="attachments"><Paperclip className="h-4 w-4" /> Attachments</TabsTrigger>
          <TabsTrigger value="time"><Clock className="h-4 w-4" /> Time</TabsTrigger>
          <TabsTrigger value="activity"><ActivityIcon className="h-4 w-4" /> Activity</TabsTrigger>
          <TabsTrigger value="history"><History className="h-4 w-4" /> History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview task={task} /></TabsContent>
        <TabsContent value="checklist"><ChecklistTab task={task} /></TabsContent>
        <TabsContent value="comments"><CommentsTab task={task} /></TabsContent>
        <TabsContent value="attachments"><AttachmentsTab task={task} /></TabsContent>
        <TabsContent value="time"><TimeTab task={task} /></TabsContent>
        <TabsContent value="activity"><ActivityTab task={task} /></TabsContent>
        <TabsContent value="history"><ActivityTab task={task} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Overview({ task }: { task: TaskRow }) {
  const upd = useServerFn(updateTask);
  const qc = useQueryClient();
  const [description, setDescription] = useState(task.description ?? "");
  useEffect(() => setDescription(task.description ?? ""), [task.description]);
  const save = useMutation({
    mutationFn: () => upd({ data: { id: task.id, description: description || null } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["task", task.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2">
        <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Textarea rows={8} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Progress"><Progress value={task.progress} /> <span className="text-xs text-muted-foreground">{task.progress}%</span></Row>
          <Row label="Estimated">{task.estimated_hours ?? "—"} hrs</Row>
          <Row label="Logged">{Number(task.logged_hours ?? 0).toFixed(2)} hrs</Row>
          <Row label="Start">{task.start_date ?? "—"}</Row>
          <Row label="Due">{task.due_date ?? "—"}</Row>
          <Row label="Labels">
            {task.labels?.length ? task.labels.map((l) => <Badge key={l} variant="outline">{l}</Badge>) : "—"}
          </Row>
          <Row label="Created">{new Date(task.created_at).toLocaleString()}</Row>
          <Row label="Updated">{new Date(task.updated_at).toLocaleString()}</Row>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center justify-end gap-1 text-right">{children}</div>
    </div>
  );
}

function ChecklistTab({ task }: { task: TaskRow }) {
  const qc = useQueryClient();
  const list = useServerFn(listChecklist);
  const add = useServerFn(addChecklistItem);
  const upd = useServerFn(updateChecklistItem);
  const del = useServerFn(deleteChecklistItem);
  const [newItem, setNewItem] = useState("");

  const q = useQuery({ queryKey: ["checklist", task.id], queryFn: () => list({ data: { task_id: task.id } }) });
  const inv = () => qc.invalidateQueries({ queryKey: ["checklist", task.id] });

  useEffect(() => {
    const ch = supabase
      .channel(`chk-${task.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_checklist", filter: `task_id=eq.${task.id}` }, inv)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [task.id]);

  const items = q.data ?? [];
  const done = items.filter((i) => i.is_done).length;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Checklist ({done}/{items.length})</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="Add checklist item…" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <Button onClick={() => { if (!newItem.trim()) return; add({ data: { task_id: task.id, organization_id: task.organization_id, content: newItem.trim() } }).then(() => { setNewItem(""); inv(); }).catch((e: Error) => toast.error(e.message)); }}>Add</Button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No checklist items yet.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-2 rounded-md border p-2">
                <Checkbox checked={it.is_done} onCheckedChange={(v) => upd({ data: { id: it.id, is_done: !!v } }).then(inv)} />
                <span className={`flex-1 text-sm ${it.is_done ? "line-through text-muted-foreground" : ""}`}>{it.content}</span>
                <Button size="icon" variant="ghost" onClick={() => del({ data: { id: it.id } }).then(inv)}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CommentsTab({ task }: { task: TaskRow }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const list = useServerFn(listComments);
  const add = useServerFn(addComment);
  const upd = useServerFn(updateComment);
  const del = useServerFn(deleteComment);
  const listAtt = useServerFn(listAttachments);
  const recAtt = useServerFn(recordAttachment);
  const delAtt = useServerFn(deleteAttachment);
  const sign = useServerFn(signTaskAttachment);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const MAX = 15 * 1024 * 1024;

  const q = useQuery({ queryKey: ["comments", task.id], queryFn: () => list({ data: { task_id: task.id } }) });
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["comments", task.id] });
    qc.invalidateQueries({ queryKey: ["cmt-attachments", task.id] });
    qc.invalidateQueries({ queryKey: ["attachments", task.id] });
  };

  const attQ = useQuery({
    queryKey: ["cmt-attachments", task.id],
    queryFn: () => listAtt({ data: { task_id: task.id } }),
  });
  const attByComment = useMemo(() => {
    const map = new Map<string, Array<{ id: string; file_name: string; storage_path: string; file_size: number; mime_type: string }>>();
    for (const a of (attQ.data ?? []) as Array<{ id: string; comment_id: string | null; file_name: string; storage_path: string; file_size: number; mime_type: string }>) {
      if (!a.comment_id) continue;
      const arr = map.get(a.comment_id) ?? [];
      arr.push(a);
      map.set(a.comment_id, arr);
    }
    return map;
  }, [attQ.data]);

  const membersQ = useQuery({
    queryKey: ["org-member-profiles", task.organization_id],
    queryFn: async () => {
      const { data: mems, error } = await supabase.from("organization_members").select("user_id").eq("organization_id", task.organization_id);
      if (error) throw error;
      const ids = (mems ?? []).map((m) => m.user_id).filter(Boolean);
      if (!ids.length) return [] as Array<{ id: string; full_name: string | null }>;
      const { data: profs, error: pe } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      if (pe) throw pe;
      return (profs ?? []) as Array<{ id: string; full_name: string | null }>;
    },
  });

  useEffect(() => {
    const ch = supabase.channel(`cmt-${task.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${task.id}` }, inv)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_attachments", filter: `task_id=eq.${task.id}` }, inv)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const comments = q.data ?? [];
  const grouped = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_id);
    const byParent = new Map<string, typeof comments>();
    comments.forEach((c) => { if (c.parent_id) { const a = byParent.get(c.parent_id) ?? []; a.push(c); byParent.set(c.parent_id, a); } });
    return { roots, byParent };
  }, [comments]);

  const pickFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).filter((f) => {
      if (f.size > MAX) { toast.error(`${f.name} exceeds 15MB`); return false; }
      return true;
    });
    setPending((p) => [...p, ...arr]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    if (!text.trim() && pending.length === 0) return;
    setBusy(true);
    try {
      const row = await add({ data: { task_id: task.id, organization_id: task.organization_id, content: text.trim() || "(attachment)", parent_id: replyTo } });
      for (const file of pending) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const path = `${task.organization_id}/${task.id}/comments/${(row as { id: string }).id}/${Date.now()}-${safe}`;
        const { error } = await supabase.storage.from("task-attachments").upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (error) throw error;
        await recAtt({ data: {
          task_id: task.id, organization_id: task.organization_id,
          file_name: file.name, file_size: file.size,
          mime_type: file.type || "application/octet-stream",
          storage_path: path, comment_id: (row as { id: string }).id,
        } });
      }
      setText(""); setReplyTo(null); setPending([]);
      inv();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async (row: { storage_path: string; file_name: string }) => {
    try {
      const EXPIRES = 300;
      const url = await getCachedSignedUrl(
        `task-attachments:${row.storage_path}:${EXPIRES}`,
        EXPIRES,
        async () => (await sign({ data: { storage_path: row.storage_path, expires_in: EXPIRES } })).url,
      );
      const a = document.createElement("a");
      a.href = url; a.download = row.file_name; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast.error((e as Error).message); }
  };

  const removeAttachment = async (a: { id: string; storage_path: string }) => {
    try {
      await delAtt({ data: { id: a.id, storage_path: a.storage_path } });
      inv();
    } catch (e) { toast.error((e as Error).message); }
  };

  const renderOne = (c: (typeof comments)[number], indent = false) => {
    const files = attByComment.get(c.id) ?? [];
    return (
      <div key={c.id} className={`rounded-md border p-3 ${indent ? "ml-8" : ""}`}>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{new Date(c.created_at).toLocaleString()}</span>
          {c.author_id === user?.id && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setEditingId(c.id); setEditingText(c.content); }}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => del({ data: { id: c.id } }).then(inv)}>Delete</Button>
            </div>
          )}
        </div>
        {editingId === c.id ? (
          <div className="space-y-2">
            <MentionTextarea value={editingText} onChange={setEditingText} members={membersQ.data ?? []} rows={2} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => upd({ data: { id: c.id, content: editingText } }).then(() => { setEditingId(null); inv(); })}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <MentionContent text={c.content} />
        )}
        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1 text-xs">
                <Paperclip className="h-3 w-3 shrink-0" />
                <button type="button" onClick={() => download(f)} className="min-w-0 flex-1 truncate text-left hover:underline">
                  {f.file_name}
                </button>
                <span className="text-muted-foreground">{(f.file_size / 1024).toFixed(1)} KB</span>
                {c.author_id === user?.id && (
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeAttachment(f)} title="Remove">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!indent && (
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => setReplyTo(c.id)}>Reply</Button>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Comments</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <MentionTextarea
            value={text}
            onChange={setText}
            members={membersQ.data ?? []}
            placeholder={replyTo ? "Write a reply… type @ to mention" : "Add a comment… type @ to mention"}
            rows={2}
          />
          {pending.length > 0 && (
            <ul className="space-y-1">
              {pending.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1 text-xs">
                  <Paperclip className="h-3 w-3" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => pickFiles(e.target.files)} />
          <div className="flex items-center gap-2">
            <Button onClick={submit} disabled={busy}>{busy ? "Posting…" : replyTo ? "Reply" : "Post"}</Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Paperclip className="h-4 w-4" /> Attach
            </Button>
            {replyTo && <Button variant="ghost" onClick={() => setReplyTo(null)}>Cancel reply</Button>}
            <p className="text-xs text-muted-foreground">Attach up to 15MB per file. Type <span className="font-mono">@</span> to mention.</p>
          </div>
        </div>
        <div className="space-y-2">
          {grouped.roots.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
          {grouped.roots.map((c) => (
            <div key={c.id} className="space-y-2">
              {renderOne(c)}
              {(grouped.byParent.get(c.id) ?? []).map((r) => renderOne(r, true))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AttachmentsTab({ task }: { task: TaskRow }) {
  const qc = useQueryClient();
  const list = useServerFn(listAttachments);
  const record = useServerFn(recordAttachment);
  const del = useServerFn(deleteAttachment);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({ queryKey: ["attachments", task.id], queryFn: () => list({ data: { task_id: task.id, comment_id: null } }) });
  const inv = () => qc.invalidateQueries({ queryKey: ["attachments", task.id] });

  useEffect(() => {
    const ch = supabase.channel(`att-${task.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_attachments", filter: `task_id=eq.${task.id}` }, inv)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [task.id]);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const path = `${task.organization_id}/${task.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("task-attachments").upload(path, file, { upsert: false });
      if (error) throw error;
      await record({ data: { task_id: task.id, organization_id: task.organization_id, file_name: file.name, file_size: file.size, mime_type: file.type || "application/octet-stream", storage_path: path } });
      toast.success("Uploaded");
      inv();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const download = async (path: string, name: string) => {
    try {
      const EXPIRES = 60;
      const url = await getCachedSignedUrl(
        `task-attachments:${path}:${EXPIRES}`,
        EXPIRES,
        async () => {
          const { data, error } = await supabase.storage.from("task-attachments").createSignedUrl(path, EXPIRES);
          if (error) throw error;
          return data.signedUrl;
        },
      );
      const a = document.createElement("a");
      a.href = url; a.download = name; a.target = "_blank"; a.click();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Attachments</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload file"}
        </Button>
        {(q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No attachments yet.</p>
        ) : (
          <ul className="divide-y">
            {(q.data ?? []).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.file_name}</p>
                  <p className="text-xs text-muted-foreground">{((a.file_size ?? 0) / 1024).toFixed(1)} KB · {new Date(a.created_at).toLocaleString()}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => download(a.storage_path, a.file_name)}><Download className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => del({ data: { id: a.id, storage_path: a.storage_path } }).then(inv)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TimeTab({ task }: { task: TaskRow }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const list = useServerFn(listTimeEntries);
  const start = useServerFn(startTimer);
  const stop = useServerFn(stopTimer);
  const manual = useServerFn(addManualTime);
  const del = useServerFn(deleteTimeEntry);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");

  const q = useQuery({ queryKey: ["time", task.id], queryFn: () => list({ data: { task_id: task.id } }) });
  const inv = () => { qc.invalidateQueries({ queryKey: ["time", task.id] }); qc.invalidateQueries({ queryKey: ["task", task.id] }); };

  useEffect(() => {
    const ch = supabase.channel(`tim-${task.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_time_entries", filter: `task_id=eq.${task.id}` }, inv)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const running = (q.data ?? []).find((e) => e.user_id === user?.id && !e.ended_at);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Time tracking</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div><span className="text-muted-foreground">Estimated:</span> <b>{task.estimated_hours ?? "—"} hrs</b></div>
          <div><span className="text-muted-foreground">Logged:</span> <b>{Number(task.logged_hours ?? 0).toFixed(2)} hrs</b></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button size="sm" variant="destructive" onClick={() => stop({ data: { id: running.id } }).then(inv)}>
              <Square className="h-4 w-4" /> Stop timer
            </Button>
          ) : (
            <Button size="sm" onClick={() => start({ data: { task_id: task.id, organization_id: task.organization_id } }).then(inv)}>
              <Play className="h-4 w-4" /> Start timer
            </Button>
          )}
        </div>
        <div className="rounded-md border p-3">
          <p className="mb-2 text-sm font-medium">Add manual entry</p>
          <div className="grid gap-2 md:grid-cols-3">
            <Input type="number" min="0" step="0.25" placeholder="Hours" value={hours} onChange={(e) => setHours(e.target.value)} />
            <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="md:col-span-2" />
          </div>
          <Button size="sm" className="mt-2" onClick={() => {
            const h = Number(hours);
            if (!h || h <= 0) return toast.error("Enter valid hours");
            manual({ data: { task_id: task.id, organization_id: task.organization_id, hours: h, note: note || undefined } })
              .then(() => { setHours(""); setNote(""); inv(); toast.success("Logged"); })
              .catch((e: Error) => toast.error(e.message));
          }}>Log time</Button>
        </div>
        {(q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No time entries yet.</p>
        ) : (
          <ul className="divide-y">
            {(q.data ?? []).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p><b>{e.hours ? `${Number(e.hours).toFixed(2)} hrs` : "Running…"}</b> {e.note && <span className="text-muted-foreground">— {e.note}</span>}</p>
                  <p className="text-xs text-muted-foreground">{new Date(e.started_at).toLocaleString()}{e.ended_at ? ` → ${new Date(e.ended_at).toLocaleString()}` : ""}</p>
                </div>
                {e.user_id === user?.id && (
                  <Button size="icon" variant="ghost" onClick={() => del({ data: { id: e.id } }).then(inv)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityTab({ task }: { task: TaskRow }) {
  const q = useQuery({
    queryKey: ["activity", task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .eq("organization_id", task.organization_id)
        .eq("entity_type", "task")
        .eq("entity_id", task.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-24 w-full" /> :
          (q.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No activity recorded yet.</p> :
          <ul className="space-y-2">
            {(q.data ?? []).map((a) => (
              <li key={a.id} className="rounded-md border p-2 text-sm">
                <p><span className="font-medium capitalize">{a.action}</span> — {a.summary}</p>
                <p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        }
      </CardContent>
    </Card>
  );
}
