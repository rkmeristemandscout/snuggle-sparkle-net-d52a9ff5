import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { departmentSchema, slugSchema } from "@/lib/auth-schemas";

const uuid = z.string().uuid();
function fail(msg: string): never {
  throw new Error(msg);
}

const statusFilter = z.enum(["active", "archived", "deleted", "all"]).default("active");
const sortField = z.enum(["created_at", "name"]).default("name");
const sortDir = z.enum(["asc", "desc"]).default("asc");

export const listDepartments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: {
      organizationId: string;
      search?: string;
      status?: "active" | "archived" | "deleted" | "all";
      sort?: "created_at" | "name";
      dir?: "asc" | "desc";
      limit?: number;
      cursor?: { created_at: string; id: string } | null;
    }) =>
      z
        .object({
          organizationId: uuid,
          search: z.string().trim().max(80).optional(),
          status: statusFilter,
          sort: sortField,
          dir: sortDir,
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z
            .object({ created_at: z.string(), id: uuid })
            .nullable()
            .optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("departments")
      .select(
        "id, name, slug, description, manager_id, archived_at, deleted_at, created_at",
        { count: "exact" },
      )
      .eq("organization_id", data.organizationId);

    if (data.status === "active") q = q.is("deleted_at", null).is("archived_at", null);
    else if (data.status === "archived")
      q = q.is("deleted_at", null).not("archived_at", "is", null);
    else if (data.status === "deleted") q = q.not("deleted_at", "is", null);

    if (data.search) q = q.ilike("name", `%${data.search}%`);

    const asc = data.dir === "asc";
    q = q.order(data.sort, { ascending: asc }).order("id", { ascending: asc }).limit(data.limit);

    if (data.cursor && data.sort === "created_at") {
      const op = asc ? "gt" : "lt";
      q = q[op]("created_at", data.cursor.created_at);
    }

    const { data: rows, error, count } = await q;
    if (error) fail(error.message);
    const list = rows ?? [];
    const nextCursor =
      list.length === data.limit
        ? { created_at: list[list.length - 1].created_at, id: list[list.length - 1].id }
        : null;
    return { rows: list, nextCursor, total: count ?? null };
  });

export const createDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { organizationId: string } & z.infer<typeof departmentSchema>) =>
    z.object({ organizationId: uuid }).merge(departmentSchema).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: dup } = await context.supabase
      .from("departments")
      .select("id")
      .eq("organization_id", data.organizationId)
      .is("deleted_at", null)
      .or(`slug.eq.${data.slug},name.ilike.${data.name}`)
      .limit(1)
      .maybeSingle();
    if (dup) fail("A department with this name or slug already exists");

    const { data: row, error } = await context.supabase
      .from("departments")
      .insert({
        organization_id: data.organizationId,
        name: data.name,
        slug: data.slug,
        description: data.description || null,
        created_by: context.userId,
      })
      .select("id, name, slug, description")
      .single();
    if (error) fail(error.message);
    return row!;
  });

export const updateDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string } & Partial<z.infer<typeof departmentSchema>>) =>
    z
      .object({
        departmentId: uuid,
        name: z.string().trim().min(2).max(60).optional(),
        slug: slugSchema.optional(),
        description: z.string().trim().max(280).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current } = await context.supabase
      .from("departments")
      .select("id, organization_id")
      .eq("id", data.departmentId)
      .maybeSingle();
    if (!current) fail("Department not found");

    if (data.name || data.slug) {
      const filters: string[] = [];
      if (data.slug) filters.push(`slug.eq.${data.slug}`);
      if (data.name) filters.push(`name.ilike.${data.name}`);
      const { data: dup } = await context.supabase
        .from("departments")
        .select("id")
        .eq("organization_id", current!.organization_id)
        .neq("id", data.departmentId)
        .is("deleted_at", null)
        .or(filters.join(","))
        .limit(1)
        .maybeSingle();
      if (dup) fail("Another department already uses this name or slug");
    }

    const patch: { name?: string; slug?: string; description?: string | null } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.slug !== undefined) patch.slug = data.slug;
    if (data.description !== undefined) patch.description = data.description || null;
    const { data: row, error } = await context.supabase
      .from("departments")
      .update(patch)
      .eq("id", data.departmentId)
      .select("id, name, slug, description")
      .single();
    if (error) fail(error.message);
    return row!;
  });

export const deleteDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string }) => z.object({ departmentId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("soft_delete_department", {
      _dept: data.departmentId,
    });
    if (error) fail(error.message);
    return { ok: true };
  });

export const archiveDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string; archive: boolean }) =>
    z.object({ departmentId: uuid, archive: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("archive_department", {
      _dept: data.departmentId,
      _archive: data.archive,
    });
    if (error) fail(error.message);
    return { ok: true };
  });

export const restoreDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string }) => z.object({ departmentId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("restore_department", {
      _dept: data.departmentId,
    });
    if (error) fail(error.message);
    return { ok: true };
  });

export const setDepartmentManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string; managerId: string | null }) =>
    z.object({ departmentId: uuid, managerId: uuid.nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_department_manager", {
      _dept: data.departmentId,
      _manager: data.managerId as string,
    });
    if (error) fail(error.message);
    return { ok: true };
  });

export const getDepartment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string }) => z.object({ departmentId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("departments")
      .select(
        "id, organization_id, name, slug, description, manager_id, archived_at, deleted_at, created_at, updated_at",
      )
      .eq("id", data.departmentId)
      .maybeSingle();
    if (error) fail(error.message);
    if (!row) fail("Department not found");
    return row!;
  });

export const getDepartmentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string }) => z.object({ departmentId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("get_department_stats", {
      _dept: data.departmentId,
    });
    if (error) fail(error.message);
    return row as {
      member_count: number;
      child_count: number;
      created_at: string;
      manager_id: string | null;
    } | null;
  });

export const bulkAssignDepartmentMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string; userIds: string[] }) =>
    z.object({ departmentId: uuid, userIds: z.array(uuid).min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: assigned, error } = await context.supabase.rpc(
      "bulk_assign_department_members",
      { _dept: data.departmentId, _users: data.userIds },
    );
    if (error) fail(error.message);
    return { assigned: assigned as number };
  });

export const setDepartmentParent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string; parentId: string | null }) =>
    z.object({ departmentId: uuid, parentId: uuid.nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_department_parent", {
      _dept: data.departmentId,
      _parent: data.parentId as string,
    });
    if (error) fail(error.message);
    return { ok: true };
  });

export const getDepartmentActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string; limit?: number }) =>
    z
      .object({ departmentId: uuid, limit: z.number().int().min(1).max(100).default(30) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("activity_logs")
      .select("id, action, summary, metadata, actor_id, created_at")
      .eq("entity_type", "department")
      .eq("entity_id", data.departmentId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) fail(error.message);
    return rows ?? [];
  });

export const getDepartmentMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { departmentId: string }) => z.object({ departmentId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: dept } = await context.supabase
      .from("departments")
      .select("id, organization_id")
      .eq("id", data.departmentId)
      .maybeSingle();
    if (!dept) fail("Department not found");

    const { data: members, error } = await context.supabase
      .from("organization_members")
      .select("user_id, role, joined_at")
      .eq("organization_id", dept!.organization_id)
      .eq("department_id", data.departmentId);
    if (error) fail(error.message);
    const ids = (members ?? []).map((m) => m.user_id);
    let profiles: Record<string, { full_name: string | null; email: string | null }> = {};
    if (ids.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      profiles = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
    }
    return (members ?? []).map((m) => ({ ...m, profile: profiles[m.user_id] ?? null }));
  });
