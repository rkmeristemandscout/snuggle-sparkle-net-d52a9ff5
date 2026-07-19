import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAnalyticsSnapshot } from "@/lib/analytics.functions";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsPage,
});

type Snapshot = {
  members?: number;
  teams?: number;
  departments?: number;
  projects_total?: number;
  projects_active?: number;
  tasks_total?: number;
  tasks_open?: number;
  tasks_done_7d?: number;
  invites_pending?: number;
  activity_30d?: number;
  audit_30d?: number;
  generated_at?: string;
};

function AnalyticsPage() {
  const { currentMembership } = useCurrentOrg();
  const org = currentMembership?.organization;
  const fn = useServerFn(getAnalyticsSnapshot);

  const q = useQuery({
    enabled: !!org,
    queryKey: ["analytics", org?.id],
    queryFn: async (): Promise<Snapshot> =>
      (await fn({ data: { organization_id: org!.id } })) as Snapshot,
  });

  if (!org) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Select an organization to see analytics.
      </div>
    );
  }

  const s = q.data ?? {};
  const cards = [
    { label: "Members", value: s.members },
    { label: "Teams", value: s.teams },
    { label: "Departments", value: s.departments },
    { label: "Projects", value: s.projects_total, hint: `${s.projects_active ?? 0} active` },
    { label: "Tasks", value: s.tasks_total, hint: `${s.tasks_open ?? 0} open` },
    { label: "Tasks done (7d)", value: s.tasks_done_7d },
    { label: "Pending invites", value: s.invites_pending },
    { label: "Activity (30d)", value: s.activity_30d },
    { label: "Audit events (30d)", value: s.audit_30d },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Insights across your workspace.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading analytics…
        </div>
      ) : q.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {(q.error as Error).message}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <Card key={c.label}>
                <CardHeader className="pb-2">
                  <CardDescription>{c.label}</CardDescription>
                  <CardTitle className="text-3xl">{c.value ?? 0}</CardTitle>
                </CardHeader>
                {c.hint && (
                  <CardContent className="pt-0 text-xs text-muted-foreground">{c.hint}</CardContent>
                )}
              </Card>
            ))}
          </div>
          {s.generated_at && (
            <p className="text-xs text-muted-foreground">
              Generated {new Date(s.generated_at).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}
