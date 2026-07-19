import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Building2, Mail, User, Shield, Users, KeyRound, Flag, FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentOrg } from "@/hooks/use-current-org";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isIndex = pathname === "/settings" || pathname === "/settings/";
  if (!isIndex) return <Outlet />;
  return <SettingsHub />;
}

function SettingsHub() {
  const { currentMembership } = useCurrentOrg();
  const slug = currentMembership?.organization.slug;
  const role = currentMembership?.role;
  const isAdmin = role === "owner" || role === "admin";

  const sections = [
    {
      title: "Organization",
      description: "Name, slug, logo and workspace details.",
      icon: Building2,
      to: slug ? `/organizations/${slug}/settings` : "/organizations",
      show: !!slug,
    },
    {
      title: "Members",
      description: "Invite, manage and remove workspace members.",
      icon: Users,
      to: "/members",
      show: true,
    },
    {
      title: "Email",
      description: "Configure email delivery and templates.",
      icon: Mail,
      to: "/settings/email",
      show: isAdmin,
    },
    {
      title: "API Keys",
      description: "Generate and revoke keys for programmatic access.",
      icon: KeyRound,
      to: "/api-keys",
      show: isAdmin,
    },
    {
      title: "Feature Flags",
      description: "Toggle experimental features for the workspace.",
      icon: Flag,
      to: "/feature-flags",
      show: isAdmin,
    },
    {
      title: "Audit Logs",
      description: "Review security and administrative events.",
      icon: FileText,
      to: "/audit-logs",
      show: isAdmin,
    },
    {
      title: "Profile",
      description: "Your personal profile, password and 2FA.",
      icon: User,
      to: "/profile",
      show: true,
    },
    {
      title: "Security",
      description: "Change password, enable two-factor authentication.",
      icon: Shield,
      to: "/profile",
      show: true,
    },
  ].filter((s) => s.show);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your workspace, members, integrations and personal account.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.title} to={s.to} className="block">
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-md border bg-muted/40 p-2">
                    <s.icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">{s.title}</CardTitle>
                </div>
                <CardDescription className="pt-2">{s.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Open →</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
