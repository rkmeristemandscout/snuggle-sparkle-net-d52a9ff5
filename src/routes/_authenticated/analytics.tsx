import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">Insights across your workspace.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming Soon</CardTitle>
          <CardDescription>This section is under construction.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Analytics dashboards are on the way.
        </CardContent>
      </Card>
    </div>
  );
}
