import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { formatDistanceToNow, format } from "date-fns";
import { Activity as ActivityIcon, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { usePermissions } from "@/hooks/use-permissions";
import { listActivity, type ActivityRow } from "@/lib/activity.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/activity")({
  component: ActivityPage,
});

type ActorMap = Record<string, { full_name: string | null; avatar_url: string | null }>;

const ENTITY_TYPES = [
  "all",
  "organization",
  "team",
  "department",
  "project",
  "task",
  "invitation",
  "api_key",
  "billing",
  "profile",
  "member",
];

const RANGES: Array<{ key: string; label: string; hours: number | null }> = [
  { key: "24h", label: "Last 24 hours", hours: 24 },
  { key: "7d", label: "Last 7 days", hours: 24 * 7 },
  { key: "30d", label: "Last 30 days", hours: 24 * 30 },
  { key: "all", label: "All time", hours: null },
];

function ActivityPage() {
  const { currentOrgId } = useCurrentOrg();
  const { can, isSuperAdmin, isLoading: permsLoading } = usePermissions();
  const canView = can("activity.view") || isSuperAdmin;
  const qc = useQueryClient();
  const listFn = useServerFn(listActivity);

  const [entityType, setEntityType] = useState("all");
  const [range, setRange] = useState("7d");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fromIso = useMemo(() => {
    const cfg = RANGES.find((r) => r.key === range);
    if (!cfg?.hours) return undefined;
    return new Date(Date.now() - cfg.hours * 3600_000).toISOString();
  }, [range]);

  const infinite = useInfiniteQuery({
    enabled: !!currentOrgId && canView,
    queryKey: ["activity-feed", currentOrgId, entityType, range, debounced],
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: async ({ pageParam }) =>
      listFn({
        data: {
          organizationId: currentOrgId!,
          entityType: entityType === "all" ? undefined : entityType,
          search: debounced || undefined,
          from: fromIso,
          limit: 30,
          cursor: pageParam ?? undefined,
        },
      }),
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows: ActivityRow[] = useMemo(
    () => infinite.data?.pages.flatMap((p) => p.items) ?? [],
    [infinite.data],
  );

  const actorIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))),
    [rows],
  );

  const { data: actors = {} } = useQuery<ActorMap>({
    enabled: actorIds.length > 0,
    queryKey: ["activity-actors", actorIds.sort().join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", actorIds);
      if (error) throw error;
      const map: ActorMap = {};
      for (const p of data ?? []) map[p.id] = { full_name: p.full_name, avatar_url: p.avatar_url };
      return map;
    },
  });

  useEffect(() => {
    if (!currentOrgId || !canView) return;
    const ch = supabase
      .channel(`activity-feed:${currentOrgId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_logs",
          filter: `organization_id=eq.${currentOrgId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["activity-feed", currentOrgId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentOrgId, canView, qc]);

  if (permsLoading) return null;
  if (!canView) {
    return (
      <div className="rounded-lg border p-8 text-center text-muted-foreground">
        You don't have permission to view activity.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2">
            <ActivityIcon className="h-6 w-6" /> Activity
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything happening across your workspace.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => infinite.refetch()}
          disabled={infinite.isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${infinite.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle>Feed</CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="activity-search"
                placeholder="Search summary…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c === "all" ? "All types" : c.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {infinite.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : infinite.isError ? (
            <p className="text-sm text-destructive">
              Failed to load activity. {(infinite.error as Error).message}
            </p>
          ) : rows.length === 0 ? (
            <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
              No activity matches these filters yet.
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => {
                const actor = r.actor_id ? actors[r.actor_id] : null;
                return (
                  <li key={r.id} className="py-3 flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">{r.summary}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {r.entity_type}
                        </Badge>
                        <span className="font-mono">{r.action}</span>
                        <span>·</span>
                        <span>{actor?.full_name ?? (r.actor_id ? "Unknown" : "System")}</span>
                        <span>·</span>
                        <span title={format(new Date(r.created_at), "PPpp")}>
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {infinite.hasNextPage && (
            <div className="pt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => infinite.fetchNextPage()}
                disabled={infinite.isFetchingNextPage}
              >
                {infinite.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
