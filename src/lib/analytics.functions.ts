import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAnalyticsSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { organization_id: string }) =>
    z.object({ organization_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: snap, error } = await context.supabase.rpc("get_analytics_snapshot", {
      _org: data.organization_id,
    });
    if (error) throw new Error(error.message);
    return snap as Record<string, number | string>;
  });
