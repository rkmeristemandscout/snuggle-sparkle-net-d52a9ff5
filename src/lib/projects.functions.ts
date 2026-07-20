import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "project";

const ProjectStatus = z.enum(["planning", "active", "on_hold", "completed", "archived"]);
const ProjectPriority = z.enum(["low", "medium", "high", "urgent"]);

const CreateSchema = z.object({
  organization_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  code: z.string().max(40).optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  client: z.string().max(160).optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  team_id: z.string().uuid().optional().nullable(),
  manager_id: z.string().uuid().optional().nullable(),
  owner_id: z.string().uuid().optional().nullable(),
  priority: ProjectPriority.optional(),
  status: ProjectStatus.optional(),
  start_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  budget: z.number().nonnegative().optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  color: z.string().max(20).optional().nullable(),
  cover_image_url: z.string().max(500).optional().nullable(),
  logo_url: z.string().max(500).optional().nullable(),
  member_ids: z.array(z.string().uuid()).max(200).optional(),
});

const UpdateSchema = CreateSchema.partial().extend({
  id: z.string().uuid(),
  progress: z.number().int().min(0).max(100).optional(),
});

async function assertMember(ctx: { supabase: any; userId: string }, organization_id: string) {
  const { data, error } = await ctx.supabase
    .from("organization_members")
    .select("id")
    .eq("organization_id", organization_id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not a member of this organization");
}

async function ensureUnique(ctx: { supabase: any }, org: string, name: string, code: string | null | undefined, excludeId?: string) {
  const nameQ = ctx.supabase
    .from("projects")
    .select("id")
    .eq("organization_id", org)
    .is("deleted_at", null)
    .ilike("name", name);
  const { data: nameHit } = await nameQ;
  if (nameHit?.some((r: any) => r.id !== excludeId)) {
    throw new Error("A project with this name already exists");
  }
  if (code) {
    const { data: codeHit } = await ctx.supabase
      .from("projects")
      .select("id")
      .eq("organization_id", org)
      .is("deleted_at", null)
      .ilike("code", code);
    if (codeHit?.some((r: any) => r.id !== excludeId)) {
      throw new Error("A project with this code already exists");
    }
  }
}

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        organization_id: z.string().uuid(),
        search: z.string().optional(),
        status: ProjectStatus.optional(),
        priority: ProjectPriority.optional(),
        department_id: z.string().uuid().optional(),
        manager_id: z.string().uuid().optional(),
        team_id: z.string().uuid().optional(),
        include_archived: z.boolean().optional(),
        include_deleted: z.boolean().optional(),
        sort: z.enum(["created_at", "updated_at", "name", "due_date", "priority", "status", "progress"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("projects")
      .select("*", { count: "exact" })
      .eq("organization_id", data.organization_id);

    if (!data.include_deleted) q = q.is("deleted_at", null);
    if (!data.include_archived) q = q.is("archived_at", null);
    if (data.status) q = q.eq("status", data.status);
    if (data.priority) q = q.eq("priority", data.priority);
    if (data.department_id) q = q.eq("department_id", data.department_id);
    if (data.manager_id) q = q.eq("manager_id", data.manager_id);
    if (data.team_id) q = q.eq("team_id", data.team_id);
    if (data.search) q = q.or(`name.ilike.%${data.search}%,code.ilike.%${data.search}%,client.ilike.%${data.search}%`);

    q = q
      .order(data.sort ?? "created_at", { ascending: (data.order ?? "desc") === "asc" })
      .range(data.offset ?? 0, (data.offset ?? 0) + (data.limit ?? 50) - 1);

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0 };
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Project not found");
    return row;
  });

export const getProjectsStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ organization_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("projects")
      .select("status,archived_at,deleted_at,budget,progress")
      .eq("organization_id", data.organization_id);
    if (error) throw new Error(error.message);
    const active = rows.filter((r: any) => !r.deleted_at && !r.archived_at);
    const totalBudget = active.reduce((s: number, r: any) => s + Number(r.budget || 0), 0);
    const avgProgress = active.length
      ? Math.round(active.reduce((s: number, r: any) => s + Number(r.progress || 0), 0) / active.length)
      : 0;
    return {
      total: active.length,
      by_status: {
        planning: active.filter((r: any) => r.status === "planning").length,
        active: active.filter((r: any) => r.status === "active").length,
        on_hold: active.filter((r: any) => r.status === "on_hold").length,
        completed: active.filter((r: any) => r.status === "completed").length,
      },
      archived: rows.filter((r: any) => r.archived_at && !r.deleted_at).length,
      total_budget: totalBudget,
      avg_progress: avgProgress,
    };
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context, data.organization_id);
    await ensureUnique(context, data.organization_id, data.name, data.code);
    const base = slugify(data.name);
    let slug = base;
    for (let i = 1; i < 30; i++) {
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
        code: data.code ?? null,
        description: data.description ?? null,
        client: data.client ?? null,
        department_id: data.department_id ?? null,
        team_id: data.team_id ?? null,
        manager_id: data.manager_id ?? null,
        owner_id: data.owner_id ?? context.userId,
        priority: data.priority ?? "medium",
        status: data.status ?? "planning",
        start_date: data.start_date ?? null,
        due_date: data.due_date ?? null,
        budget: data.budget ?? null,
        tags: data.tags ?? [],
        color: data.color ?? null,
        cover_image_url: data.cover_image_url ?? null,
        logo_url: data.logo_url ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    if (data.member_ids?.length) {
      await context.supabase.from("project_members").insert(
        data.member_ids.map((uid) => ({
          project_id: row.id,
          user_id: uid,
          organization_id: data.organization_id,
          role: "member",
          added_by: context.userId,
        })),
      );
    }
    return row;
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, member_ids: _mi, organization_id, ...patch } = data as any;
    const { data: existing } = await context.supabase
      .from("projects")
      .select("organization_id,name,code")
      .eq("id", id)
      .maybeSingle();
    if (!existing) throw new Error("Project not found");
    const org = existing.organization_id;
    if (patch.name && patch.name !== existing.name) {
      await ensureUnique(context, org, patch.name, patch.code ?? existing.code, id);
    } else if (patch.code && patch.code !== existing.code) {
      await ensureUnique(context, org, existing.name, patch.code, id);
    }
    const { data: row, error } = await context.supabase
      .from("projects")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const archiveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .update({ archived_at: new Date().toISOString(), status: "archived" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const restoreProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .update({ archived_at: null, deleted_at: null, status: "active" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), hard: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.hard) {
      const { error } = await context.supabase.from("projects").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("projects")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const duplicateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), new_name: z.string().max(120).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: newId, error } = await context.supabase.rpc("duplicate_project", {
      _project_id: data.id,
      _new_name: data.new_name,
    } as any);
    if (error) throw new Error(error.message);
    return { id: newId as string };
  });

// ---------- Project members ----------

export const listProjectMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("project_members")
      .select("id, role, user_id, created_at, organization_id")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: any) => r.user_id);
    let profiles: any[] = [];
    if (ids.length) {
      const { data: p } = await context.supabase
        .from("profiles")
        .select("id, full_name, avatar_url, email")
        .in("id", ids);
      profiles = p ?? [];
    }
    const byId = new Map(profiles.map((p: any) => [p.id, p]));
    return (rows ?? []).map((r: any) => ({ ...r, profile: byId.get(r.user_id) ?? null }));
  });

export const addProjectMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        user_id: z.string().uuid(),
        role: z.enum(["manager", "lead", "member", "viewer"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: p } = await context.supabase
      .from("projects")
      .select("organization_id")
      .eq("id", data.project_id)
      .maybeSingle();
    if (!p) throw new Error("Project not found");
    const { error } = await context.supabase.from("project_members").insert({
      project_id: data.project_id,
      user_id: data.user_id,
      organization_id: p.organization_id,
      role: data.role ?? "member",
      added_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateProjectMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        role: z.enum(["manager", "lead", "member", "viewer"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("project_members")
      .update({ role: data.role })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeProjectMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("project_members").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------- Files -------------------- */
const FileKind = z.enum(["image", "video", "audio", "pdf", "other"]);
const filesSchema = z.object({
  project_id: z.string().uuid(),
  search: z.string().trim().max(200).optional(),
  kind: FileKind.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const listProjectFiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filesSchema.parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("project_files")
      .select("*", { count: "exact" })
      .eq("project_id", data.project_id);
    if (data.search) q = q.ilike("file_name", `%${data.search}%`);
    if (data.kind === "image") q = q.like("mime_type", "image/%");
    else if (data.kind === "video") q = q.like("mime_type", "video/%");
    else if (data.kind === "audio") q = q.like("mime_type", "audio/%");
    else if (data.kind === "pdf") q = q.eq("mime_type", "application/pdf");
    else if (data.kind === "other") {
      q = q
        .not("mime_type", "like", "image/%")
        .not("mime_type", "like", "video/%")
        .not("mime_type", "like", "audio/%")
        .neq("mime_type", "application/pdf");
    }
    if (data.from) q = q.gte("created_at", new Date(data.from).toISOString());
    if (data.to) q = q.lte("created_at", new Date(new Date(data.to).getTime() + 86400_000 - 1).toISOString());
    q = q.order("created_at", { ascending: false }).range(data.offset, data.offset + data.limit - 1);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0 };
  });

export const recordProjectFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    project_id: z.string().uuid(),
    organization_id: z.string().uuid(),
    file_name: z.string().min(1).max(300),
    file_size: z.number().int().nonnegative(),
    mime_type: z.string().max(200),
    storage_path: z.string().min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("project_files")
      .insert({ ...data, uploaded_by: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteProjectFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), storage_path: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.storage.from("project-files").remove([data.storage_path]);
    const { error } = await context.supabase.from("project_files").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const signProjectFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ storage_path: z.string(), expires_in: z.number().int().min(10).max(3600).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sig, error } = await context.supabase.storage
      .from("project-files")
      .createSignedUrl(data.storage_path, data.expires_in ?? 300);
    if (error) throw new Error(error.message);
    return { url: sig.signedUrl };
  });

/* -------------------- Discussions -------------------- */
export const listProjectDiscussions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("project_discussions")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createProjectDiscussion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    project_id: z.string().uuid(),
    organization_id: z.string().uuid(),
    parent_id: z.string().uuid().optional().nullable(),
    title: z.string().max(200).optional().nullable(),
    body: z.string().min(1).max(10000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("project_discussions")
      .insert({
        project_id: data.project_id,
        organization_id: data.organization_id,
        parent_id: data.parent_id ?? null,
        title: data.title ?? null,
        body: data.body,
        author_id: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateProjectDiscussion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    title: z.string().max(200).optional().nullable(),
    body: z.string().min(1).max(10000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("project_discussions")
      .update({ title: data.title ?? null, body: data.body })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProjectDiscussion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("project_discussions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------- File Shares (signed URL links) -------------------- */
export const listFileShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ file_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("project_file_shares")
      .select("*")
      .eq("file_id", data.file_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((rows ?? []).map((r) => r.created_by).filter(Boolean))) as string[];
    let names = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await context.supabase.from("profiles").select("id, full_name").in("id", ids);
      names = new Map((profs ?? []).map((p) => [p.id as string, (p.full_name as string) ?? "Unknown"]));
    }
    return (rows ?? []).map((r) => ({ ...r, creator_name: r.created_by ? names.get(r.created_by) ?? null : null }));
  });

export const listProjectFileShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    project_id: z.string().uuid(),
    status: z.enum(["all", "active", "expired", "revoked"]).default("all"),
    limit: z.number().int().min(1).max(200).default(100),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("project_file_shares")
      .select("*")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    const nowIso = new Date().toISOString();
    if (data.status === "active") q = q.is("revoked_at", null).gt("expires_at", nowIso);
    else if (data.status === "expired") q = q.is("revoked_at", null).lte("expires_at", nowIso);
    else if (data.status === "revoked") q = q.not("revoked_at", "is", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const shares = rows ?? [];
    const uids = Array.from(new Set(shares.map((r) => r.created_by).filter(Boolean))) as string[];
    const fids = Array.from(new Set(shares.map((r) => r.file_id)));
    const [profRes, fileRes] = await Promise.all([
      uids.length ? context.supabase.from("profiles").select("id, full_name").in("id", uids) : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      fids.length ? context.supabase.from("project_files").select("id, file_name").in("id", fids) : Promise.resolve({ data: [] as { id: string; file_name: string }[] }),
    ]);
    const nameMap = new Map((profRes.data ?? []).map((p) => [p.id, p.full_name ?? "Unknown"]));
    const fileMap = new Map((fileRes.data ?? []).map((f) => [f.id, f.file_name]));
    return shares.map((s) => ({
      ...s,
      creator_name: s.created_by ? nameMap.get(s.created_by) ?? null : null,
      file_name: fileMap.get(s.file_id) ?? "(deleted file)",
    }));
  });

export const createFileShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    file_id: z.string().uuid(),
    project_id: z.string().uuid(),
    organization_id: z.string().uuid(),
    expires_in_hours: z.number().int().min(1).max(24 * 30),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const expires_at = new Date(Date.now() + data.expires_in_hours * 3600_000).toISOString();
    const { data: row, error } = await context.supabase
      .from("project_file_shares")
      .insert({
        file_id: data.file_id,
        project_id: data.project_id,
        organization_id: data.organization_id,
        token,
        expires_at,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const revokeFileShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("project_file_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------- Discussion Reactions -------------------- */
export const listDiscussionReactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("discussion_reactions")
      .select("id, discussion_id, user_id, emoji, created_at")
      .in(
        "discussion_id",
        (await context.supabase.from("project_discussions").select("id").eq("project_id", data.project_id)).data?.map((r) => r.id) ?? [],
      );
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const toggleDiscussionReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    discussion_id: z.string().uuid(),
    organization_id: z.string().uuid(),
    emoji: z.string().min(1).max(16),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("discussion_reactions")
      .select("id")
      .eq("discussion_id", data.discussion_id)
      .eq("user_id", context.userId)
      .eq("emoji", data.emoji)
      .maybeSingle();
    if (existing) {
      const { error } = await context.supabase.from("discussion_reactions").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
      return { added: false };
    }
    const { error } = await context.supabase.from("discussion_reactions").insert({
      discussion_id: data.discussion_id,
      organization_id: data.organization_id,
      user_id: context.userId,
      emoji: data.emoji,
    });
    if (error) throw new Error(error.message);
    return { added: true };
  });
