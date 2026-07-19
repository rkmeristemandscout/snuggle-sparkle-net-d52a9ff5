import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { teamSchema, slugSchema } from "@/lib/auth-schemas";

const uuid = z.string().uuid();

function fail(msg: string): never {
  throw new Error(msg);
}

const statusFilter = z.enum(["active", "archived", "deleted", "all"]).default("active");
const sortField = z.enum(["created_at", "name"]).default("created_at");
const sortDir = z.enum(["asc", "desc"]).default("desc");

export const listTeams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: {
      organizationId: string;
      search?: string;
      status?: "active" | "archived" | "deleted" | "all";
      departmentId?: string | null;
      managerId?: string | null;
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
          departmentId: uuid.nullable().optional(),
          managerId: uuid.nullable().optional(),
          sort: sortField,
          dir: sortDir,
          limit: z.number().int().min(1).max(500).default(60),
          cursor: z
            .object({ created_at: z.string(), id: uuid })
            .nullable()
            .optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("teams")
      .select(
        "id, name, slug, description, owner_id, archived_at, deleted_at, created_at, updated_at, avatar_url, department_id, color, icon, status",
        { count: "exact" },
      )
      .eq("organization_id", data.organizationId);

    if (data.status === "active") q = q.is("deleted_at", null).is("archived_at", null);
    else if (data.status === "archived")
      q = q.is("deleted_at", null).not("archived_at", "is", null);
    else if (data.status === "deleted") q = q.not("deleted_at", "is", null);

    if (data.search) q = q.ilike("name", `%${data.search}%`);
    if (data.departmentId) q = q.eq("department_id", data.departmentId);
    if (data.managerId) q = q.eq("owner_id", data.managerId);

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

export const getTeamsDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { organizationId: string }) =>
    z.object({ organizationId: uuid }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("get_teams_dashboard_stats", {
      _org: data.organizationId,
    });
    if (error) fail(error.message);
    return (row ?? {}) as {
      total_teams: number;
      active_teams: number;
      archived_teams: number;
      total_members: number;
      active_projects: number;
      pending_tasks: number;
    };
  });


const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex value like #4F46E5")
  .optional()
  .or(z.literal(""));
const iconSchema = z.string().trim().max(40).optional().or(z.literal(""));
const teamStatusSchema = z.enum(["active", "archived", "on_hold"]).optional();

export const createTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: {
      organizationId: string;
      departmentId?: string | null;
      managerId?: string | null;
      color?: string;
      icon?: string;
      status?: "active" | "archived" | "on_hold";
      initialMemberIds?: string[];
    } & z.infer<typeof teamSchema>) =>
      z
        .object({
          organizationId: uuid,
          departmentId: uuid.nullable().optional(),
          managerId: uuid.nullable().optional(),
          color: colorSchema,
          icon: iconSchema,
          status: teamStatusSchema,
          initialMemberIds: z.array(uuid).max(200).optional(),
        })
        .merge(teamSchema)
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: dup } = await context.supabase
      .from("teams")
      .select("id")
      .eq("organization_id", data.organizationId)
      .is("deleted_at", null)
      .or(`slug.eq.${data.slug},name.ilike.${data.name}`)
      .limit(1)
      .maybeSingle();
    if (dup) fail("A team with this name or code already exists");

    if (data.departmentId) {
      const { data: dep } = await context.supabase
        .from("departments")
        .select("id, organization_id")
        .eq("id", data.departmentId)
        .maybeSingle();
      if (!dep || dep.organization_id !== data.organizationId)
        fail("Department must belong to the same organization");
    }

    if (data.managerId) {
      const { data: mgr } = await context.supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", data.organizationId)
        .eq("user_id", data.managerId)
        .maybeSingle();
      if (!mgr) fail("Manager must be a member of the organization");
    }

    const { data: row, error } = await context.supabase
      .from("teams")
      .insert({
        organization_id: data.organizationId,
        name: data.name,
        slug: data.slug,
        description: data.description || null,
        owner_id: data.managerId ?? context.userId,
        created_by: context.userId,
        department_id: data.departmentId ?? null,
        color: data.color || null,
        icon: data.icon || null,
        status: data.status ?? "active",
        archived_at: data.status === "archived" ? new Date().toISOString() : null,
      })
      .select("id, name, slug, description, owner_id, department_id, color, icon, status")
      .single();
    if (error) fail(error.message);

    if (data.initialMemberIds?.length) {
      await context.supabase.rpc("bulk_add_team_members", {
        _team: row!.id,
        _users: data.initialMemberIds,
      });
    }
    return row!;
  });


export const updateTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { teamId: string } & Partial<z.infer<typeof teamSchema>> & {
      ownerId?: string;
      departmentId?: string | null;
      color?: string;
      icon?: string;
      status?: "active" | "archived" | "on_hold";
    }) =>
      z
        .object({
          teamId: uuid,
          name: z.string().trim().min(2).max(60).optional(),
          slug: slugSchema.optional(),
          description: z.string().trim().max(280).optional().or(z.literal("")),
          ownerId: uuid.optional(),
          departmentId: uuid.nullable().optional(),
          color: colorSchema,
          icon: iconSchema,
          status: teamStatusSchema,
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current } = await context.supabase
      .from("teams")
      .select("id, organization_id")
      .eq("id", data.teamId)
      .maybeSingle();
    if (!current) fail("Team not found");

    if (data.name || data.slug) {
      const filters: string[] = [];
      if (data.slug) filters.push(`slug.eq.${data.slug}`);
      if (data.name) filters.push(`name.ilike.${data.name}`);
      const { data: dup } = await context.supabase
        .from("teams")
        .select("id")
        .eq("organization_id", current!.organization_id)
        .neq("id", data.teamId)
        .is("deleted_at", null)
        .or(filters.join(","))
        .limit(1)
        .maybeSingle();
      if (dup) fail("Another team already uses this name or code");
    }

    if (data.departmentId) {
      const { data: dep } = await context.supabase
        .from("departments")
        .select("id, organization_id")
        .eq("id", data.departmentId)
        .maybeSingle();
      if (!dep || dep.organization_id !== current!.organization_id)
        fail("Department must belong to the same organization");
    }

    const patch: {
      name?: string;
      slug?: string;
      description?: string | null;
      owner_id?: string;
      department_id?: string | null;
      color?: string | null;
      icon?: string | null;
      status?: string;
      archived_at?: string | null;
    } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.slug !== undefined) patch.slug = data.slug;
    if (data.description !== undefined) patch.description = data.description || null;
    if (data.ownerId !== undefined) patch.owner_id = data.ownerId;
    if (data.departmentId !== undefined) patch.department_id = data.departmentId;
    if (data.color !== undefined) patch.color = data.color || null;
    if (data.icon !== undefined) patch.icon = data.icon || null;
    if (data.status !== undefined) {
      patch.status = data.status;
      if (data.status === "archived") patch.archived_at = new Date().toISOString();
      else if (data.status === "active") patch.archived_at = null;
    }
    const { data: row, error } = await context.supabase
      .from("teams")
      .update(patch)
      .eq("id", data.teamId)
      .select("id, name, slug, description, owner_id, department_id, color, icon, status")
      .single();
    if (error) fail(error.message);
    return row!;
  });

export const duplicateTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string }) => z.object({ teamId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: src, error: srcErr } = await context.supabase
      .from("teams")
      .select("organization_id, name, slug, description, department_id, color, icon, owner_id")
      .eq("id", data.teamId)
      .maybeSingle();
    if (srcErr) fail(srcErr.message);
    if (!src) fail("Team not found");

    const suffix = Math.random().toString(36).slice(2, 6);
    const newName = `${src!.name} (copy)`;
    const newSlug = `${src!.slug}-copy-${suffix}`.slice(0, 60);

    const { data: row, error } = await context.supabase
      .from("teams")
      .insert({
        organization_id: src!.organization_id,
        name: newName,
        slug: newSlug,
        description: src!.description,
        department_id: src!.department_id,
        color: src!.color,
        icon: src!.icon,
        owner_id: context.userId,
        created_by: context.userId,
        status: "active",
      })
      .select("id, name, slug")
      .single();
    if (error) fail(error.message);
    return row!;
  });


export const deleteTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string }) => z.object({ teamId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("soft_delete_team", { _team: data.teamId });
    if (error) fail(error.message);
    return { ok: true };
  });

export const archiveTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string; archive: boolean }) =>
    z.object({ teamId: uuid, archive: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("archive_team", {
      _team: data.teamId,
      _archive: data.archive,
    });
    if (error) fail(error.message);
    return { ok: true };
  });

export const restoreTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string }) => z.object({ teamId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("restore_team", { _team: data.teamId });
    if (error) fail(error.message);
    return { ok: true };
  });

export const getTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string }) => z.object({ teamId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("teams")
      .select(
        "id, organization_id, name, slug, description, owner_id, archived_at, deleted_at, created_at, updated_at",
      )
      .eq("id", data.teamId)
      .maybeSingle();
    if (error) fail(error.message);
    if (!row) fail("Team not found");
    return row!;
  });

export const removeTeamLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string; newLeadId: string }) =>
    z.object({ teamId: uuid, newLeadId: uuid }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // A team must always have an owner; safely transfer ownership to the new lead.
    const { data: team } = await context.supabase
      .from("teams")
      .select("id, organization_id, owner_id")
      .eq("id", data.teamId)
      .maybeSingle();
    if (!team) fail("Team not found");
    if (team!.owner_id === data.newLeadId) return { ok: true };

    const { data: member } = await context.supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", team!.organization_id)
      .eq("user_id", data.newLeadId)
      .maybeSingle();
    if (!member) fail("New lead must be an organization member");

    const { error } = await context.supabase
      .from("teams")
      .update({ owner_id: data.newLeadId })
      .eq("id", data.teamId);
    if (error) fail(error.message);
    return { ok: true };
  });

export const setTeamLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string; leadId: string }) =>
    z.object({ teamId: uuid, leadId: uuid }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("teams")
      .update({ owner_id: data.leadId })
      .eq("id", data.teamId);
    if (error) fail(error.message);
    return { ok: true };
  });

export const addTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string; userId: string; role?: "owner" | "member" }) =>
    z
      .object({
        teamId: uuid,
        userId: uuid,
        role: z.enum(["owner", "member"]).default("member"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("team_members")
      .insert({ team_id: data.teamId, user_id: data.userId, role: data.role });
    if (error) fail(error.message);
    return { ok: true };
  });

export const removeTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string; userId: string }) =>
    z.object({ teamId: uuid, userId: uuid }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("team_members")
      .delete()
      .eq("team_id", data.teamId)
      .eq("user_id", data.userId);
    if (error) fail(error.message);
    return { ok: true };
  });

export const getTeamStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string }) => z.object({ teamId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("get_team_stats", {
      _team: data.teamId,
    });
    if (error) fail(error.message);
    return row as {
      member_count: number;
      project_count: number;
      created_at: string;
      owner_id: string;
    } | null;
  });

export const bulkAddTeamMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string; userIds: string[] }) =>
    z.object({ teamId: uuid, userIds: z.array(uuid).min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: added, error } = await context.supabase.rpc("bulk_add_team_members", {
      _team: data.teamId,
      _users: data.userIds,
    });
    if (error) fail(error.message);
    return { added: added as number };
  });

export const bulkRemoveTeamMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string; userIds: string[] }) =>
    z.object({ teamId: uuid, userIds: z.array(uuid).min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: removed, error } = await context.supabase.rpc("bulk_remove_team_members", {
      _team: data.teamId,
      _users: data.userIds,
    });
    if (error) fail(error.message);
    return { removed: removed as number };
  });

export const updateTeamAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string; avatarUrl: string | null }) =>
    z.object({ teamId: uuid, avatarUrl: z.string().url().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("teams")
      .update({ avatar_url: data.avatarUrl })
      .eq("id", data.teamId);
    if (error) fail(error.message);
    return { ok: true };
  });

export const getTeamActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d: { teamId: string; limit?: number }) =>
    z.object({ teamId: uuid, limit: z.number().int().min(1).max(100).default(30) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("activity_logs")
      .select("id, action, summary, metadata, actor_id, created_at")
      .eq("entity_type", "team")
      .eq("entity_id", data.teamId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) fail(error.message);
    return rows ?? [];
  });
