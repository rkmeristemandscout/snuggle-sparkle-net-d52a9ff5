import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";

const ProjectStatus = z.enum(["planning", "active", "on_hold", "completed", "archived"]);

const CreateSchema = z.object({
  organization_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  status: ProjectStatus.optional(),
  color: z.string().max(20).optional().nullable(),
  team_id: z.string().uuid().optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
});

const UpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  status: ProjectStatus.optional(),
  color: z.string().max(20).optional().nullable(),
  team_id: z.string().uuid().optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
});

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { organization_id: string; search?: string; status?: string; limit?: number; offset?: number }) =>
    z
      .object({
        organization_id: z.string().uuid(),
        search: z.string().optional(),
        status: ProjectStatus.optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("projects")
      .select("*", { count: "exact" })
      .eq("organization_id", data.organization_id)
      .order("created_at", { ascending: false })
      .range(data.offset ?? 0, (data.offset ?? 0) + (data.limit ?? 50) - 1);
    if (data.status) q = q.eq("status", data.status);
    if (data.search) q = q.ilike("name", `%${data.search}%`);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0 };
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const base = slugify(data.name);
    let slug = base;
    for (let i = 1; i < 20; i++) {
      const { data: exists } = await context.supabase
        .from("projects")
        .select("id")
        .eq("organization_id", data.organization_id)
        .eq("slug", slug)
        .maybeSingle();
      if (!exists) break;
      slug = `${base}-${i}`;
    }
    const { data: row, error } = await context.supabase
      .from("projects")
      .insert({
        organization_id: data.organization_id,
        name: data.name,
        slug,
        description: data.description ?? null,
        status: data.status ?? "active",
        color: data.color ?? null,
        team_id: data.team_id ?? null,
        owner_id: data.owner_id ?? context.userId,
        due_date: data.due_date ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: row, error } = await context.supabase
      .from("projects")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
