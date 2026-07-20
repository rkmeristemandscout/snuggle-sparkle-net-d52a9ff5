import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TaskStatus = z.enum(["todo", "in_progress", "in_review", "blocked", "done", "cancelled"]);
const TaskPriority = z.enum(["low", "medium", "high", "urgent"]);

const CreateSchema = z.object({
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  code: z.string().max(50).optional().nullable(),
  description: z.string().max(8000).optional().nullable(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  reporter_id: z.string().uuid().optional().nullable(),
  team_id: z.string().uuid().optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  start_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  estimated_hours: z.number().nonnegative().optional().nullable(),
  labels: z.array(z.string()).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  position: z.number().int().optional(),
});

const UpdateSchema = CreateSchema.partial().extend({ id: z.string().uuid() }).omit({ organization_id: true, project_id: true });

function empty<T>(v: T | undefined | null | ""): T | null {
  return v === undefined || v === null || v === "" ? null : v;
}

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    organization_id: string;
    project_id?: string;
    team_id?: string;
    department_id?: string;
    assignee_id?: string;
    status?: string;
    priority?: string;
    search?: string;
    include_archived?: boolean;
    include_deleted?: boolean;
    sort_by?: "created_at" | "due_date" | "priority" | "title" | "updated_at";
    sort_dir?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }) =>
    z.object({
      organization_id: z.string().uuid(),
      project_id: z.string().uuid().optional(),
      team_id: z.string().uuid().optional(),
      department_id: z.string().uuid().optional(),
      assignee_id: z.string().uuid().optional(),
      status: TaskStatus.optional(),
      priority: TaskPriority.optional(),
      search: z.string().optional(),
      include_archived: z.boolean().optional(),
      include_deleted: z.boolean().optional(),
      sort_by: z.enum(["created_at", "due_date", "priority", "title", "updated_at"]).optional(),
      sort_dir: z.enum(["asc", "desc"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .eq("organization_id", data.organization_id);
    if (!data.include_deleted) q = q.is("deleted_at", null);
    if (!data.include_archived) q = q.is("archived_at", null);
    if (data.project_id) q = q.eq("project_id", data.project_id);
    if (data.team_id) q = q.eq("team_id", data.team_id);
    if (data.department_id) q = q.eq("department_id", data.department_id);
    if (data.assignee_id) q = q.eq("assignee_id", data.assignee_id);
    if (data.status) q = q.eq("status", data.status);
    if (data.priority) q = q.eq("priority", data.priority);
    if (data.search) q = q.or(`title.ilike.%${data.search}%,code.ilike.%${data.search}%,description.ilike.%${data.search}%`);
    const sortBy = data.sort_by ?? "created_at";
    const asc = (data.sort_dir ?? "desc") === "asc";
    q = q.order(sortBy, { ascending: asc }).range(data.offset ?? 0, (data.offset ?? 0) + (data.limit ?? 50) - 1);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0 };
  });

export const getTasksStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { organization_id: string }) => z.object({ organization_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("get_tasks_stats", { _org: data.organization_id });
    if (error) throw new Error(error.message);
    return row as Record<string, number>;
  });

export const getTask = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("tasks").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tasks")
      .insert({
        organization_id: data.organization_id,
        project_id: data.project_id,
        title: data.title,
        code: empty(data.code),
        description: empty(data.description),
        status: data.status ?? "todo",
        priority: data.priority ?? "medium",
        assignee_id: empty(data.assignee_id),
        reporter_id: empty(data.reporter_id) ?? context.userId,
        team_id: empty(data.team_id),
        department_id: empty(data.department_id),
        start_date: empty(data.start_date),
        due_date: empty(data.due_date),
        estimated_hours: data.estimated_hours ?? null,
        labels: data.labels ?? [],
        progress: data.progress ?? 0,
        position: data.position ?? 0,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      clean[k] = v === "" ? null : v;
    }
    const { data: row, error } = await context.supabase.from("tasks").update(clean as never).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; hard?: boolean }) => z.object({ id: z.string().uuid(), hard: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.hard) {
      const { error } = await context.supabase.from("tasks").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const archiveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tasks").update({ archived_at: new Date().toISOString() }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const restoreTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tasks").update({ archived_at: null, deleted_at: null }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const completeTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tasks").update({ status: "done", progress: 100 }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const duplicateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("duplicate_task", { _task_id: data.id });
    if (error) throw new Error(error.message);
    return { id };
  });

/* -------------------- Checklist -------------------- */
export const listChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { task_id: string }) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("task_checklist").select("*").eq("task_id", data.task_id).order("position").order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { task_id: string; organization_id: string; content: string }) =>
    z.object({ task_id: z.string().uuid(), organization_id: z.string().uuid(), content: z.string().min(1).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("task_checklist").insert({
      task_id: data.task_id, organization_id: data.organization_id, content: data.content, created_by: context.userId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; content?: string; is_done?: boolean }) =>
    z.object({ id: z.string().uuid(), content: z.string().min(1).max(500).optional(), is_done: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("task_checklist").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("task_checklist").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------- Comments -------------------- */
export const listComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { task_id: string }) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("task_comments").select("*").eq("task_id", data.task_id).order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { task_id: string; organization_id: string; content: string; parent_id?: string | null }) =>
    z.object({ task_id: z.string().uuid(), organization_id: z.string().uuid(), content: z.string().min(1).max(4000), parent_id: z.string().uuid().nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("task_comments").insert({
      task_id: data.task_id, organization_id: data.organization_id, content: data.content,
      parent_id: data.parent_id ?? null, author_id: context.userId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; content: string }) => z.object({ id: z.string().uuid(), content: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("task_comments").update({ content: data.content }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("task_comments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------- Attachments -------------------- */
export const listAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { task_id: string }) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("task_attachments").select("*").eq("task_id", data.task_id).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { task_id: string; organization_id: string; file_name: string; file_size: number; mime_type: string; storage_path: string }) =>
    z.object({
      task_id: z.string().uuid(), organization_id: z.string().uuid(),
      file_name: z.string().min(1), file_size: z.number().int().nonnegative(),
      mime_type: z.string(), storage_path: z.string().min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("task_attachments").insert({ ...data, uploaded_by: context.userId }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; storage_path: string }) => z.object({ id: z.string().uuid(), storage_path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.storage.from("task-attachments").remove([data.storage_path]);
    const { error } = await context.supabase.from("task_attachments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------- Time Tracking -------------------- */
export const listTimeEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { task_id: string }) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("task_time_entries").select("*").eq("task_id", data.task_id).order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const startTimer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { task_id: string; organization_id: string }) => z.object({ task_id: z.string().uuid(), organization_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("task_time_entries").insert({
      task_id: data.task_id, organization_id: data.organization_id, user_id: context.userId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const stopTimer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: entry, error: e1 } = await context.supabase.from("task_time_entries").select("started_at").eq("id", data.id).single();
    if (e1) throw new Error(e1.message);
    const ended = new Date();
    const hours = Math.max(0, (ended.getTime() - new Date(entry.started_at).getTime()) / 3600000);
    const { error } = await context.supabase.from("task_time_entries").update({ ended_at: ended.toISOString(), hours: Number(hours.toFixed(2)) }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addManualTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { task_id: string; organization_id: string; hours: number; note?: string }) =>
    z.object({ task_id: z.string().uuid(), organization_id: z.string().uuid(), hours: z.number().positive().max(1000), note: z.string().max(1000).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const started = new Date();
    const ended = new Date(started.getTime() + data.hours * 3600000);
    const { error } = await context.supabase.from("task_time_entries").insert({
      task_id: data.task_id, organization_id: data.organization_id, user_id: context.userId,
      started_at: started.toISOString(), ended_at: ended.toISOString(), hours: data.hours, note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTimeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("task_time_entries").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
