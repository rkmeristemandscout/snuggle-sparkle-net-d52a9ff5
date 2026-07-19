import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TaskStatus = z.enum(["todo", "in_progress", "in_review", "done", "cancelled"]);
const TaskPriority = z.enum(["low", "medium", "high", "urgent"]);

const CreateSchema = z.object({
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  position: z.number().int().optional(),
});

const UpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  status: TaskStatus.optional(),
  priority: TaskPriority.optional(),
  assignee_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  position: z.number().int().optional(),
});

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    organization_id: string;
    project_id?: string;
    assignee_id?: string;
    status?: string;
    priority?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) =>
    z
      .object({
        organization_id: z.string().uuid(),
        project_id: z.string().uuid().optional(),
        assignee_id: z.string().uuid().optional(),
        status: TaskStatus.optional(),
        priority: TaskPriority.optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("tasks")
      .select("*", { count: "exact" })
      .eq("organization_id", data.organization_id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .range(data.offset ?? 0, (data.offset ?? 0) + (data.limit ?? 100) - 1);
    if (data.project_id) q = q.eq("project_id", data.project_id);
    if (data.assignee_id) q = q.eq("assignee_id", data.assignee_id);
    if (data.status) q = q.eq("status", data.status);
    if (data.priority) q = q.eq("priority", data.priority);
    if (data.search) q = q.ilike("title", `%${data.search}%`);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0 };
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
        description: data.description ?? null,
        status: data.status ?? "todo",
        priority: data.priority ?? "medium",
        assignee_id: data.assignee_id ?? null,
        due_date: data.due_date ?? null,
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
    const { data: row, error } = await context.supabase
      .from("tasks")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
