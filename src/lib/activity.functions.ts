// Activity module server functions.
// Provides paginated, filterable, searchable read access to activity_logs,
// scoped by RLS to the caller's organizations.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const listSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.string().min(1).max(100).optional(),
  actorId: z.string().uuid().optional(),
  entityType: z.string().min(1).max(100).optional(),
  entityId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(25),
  // Cursor: created_at ISO of last row from previous page
  cursor: z
    .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
    .optional(),
});

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type ActivityRow = {
  id: string;
  organization_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: Json;
  created_at: string;
};

export const listActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => listSchema.parse(v))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("activity_logs")
      .select(
        "id, organization_id, actor_id, action, entity_type, entity_id, summary, metadata, created_at",
      )
      .eq("organization_id", data.organizationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(data.limit + 1);

    if (data.action) q = q.eq("action", data.action);
    if (data.actorId) q = q.eq("actor_id", data.actorId);
    if (data.entityType) q = q.eq("entity_type", data.entityType);
    if (data.entityId) q = q.eq("entity_id", data.entityId);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (data.search) q = q.ilike("summary", `%${data.search}%`);
    if (data.cursor) {
      // Keyset pagination: strictly older than the cursor row
      q = q.or(
        `created_at.lt.${data.cursor.createdAt},and(created_at.eq.${data.cursor.createdAt},id.lt.${data.cursor.id})`,
      );
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const items = (rows ?? []) as ActivityRow[];
    const hasMore = items.length > data.limit;
    const page = hasMore ? items.slice(0, data.limit) : items;
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
    };
  });
