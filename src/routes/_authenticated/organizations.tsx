import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { orgSchema, type OrgValues } from "@/lib/auth-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentOrg } from "@/hooks/use-current-org";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Settings2, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/organizations")({
  component: OrganizationsPage,
});

function OrganizationsPage() {
  const qc = useQueryClient();
  const { memberships, currentOrgId, setCurrentOrgId, isLoading, refetch } = useCurrentOrg();
  const { register, handleSubmit, formState, reset } = useForm<OrgValues>({
    resolver: zodResolver(orgSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  const createOrg = useMutation({
    mutationFn: async (v: OrgValues) => {
      const { data, error } = await supabase.rpc("create_organization", {
        _name: v.name,
        _slug: v.slug,
        _description: v.description ? v.description : undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Organization created");
      reset();
      qc.invalidateQueries({ queryKey: ["memberships"] });
      const created = Array.isArray(data) ? data[0] : data;
      if (created?.id) setCurrentOrgId(created.id);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leaveOrg = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await supabase.rpc("leave_organization", { _org: orgId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Left organization");
      qc.invalidateQueries({ queryKey: ["memberships"] });
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Create a new organization</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You'll be the owner of the new workspace.
        </p>
        <form onSubmit={handleSubmit((v) => createOrg.mutate(v))} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...register("name")} />
            {formState.errors.name && (
              <p className="mt-1 text-xs text-destructive">{formState.errors.name.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" placeholder="acme-inc" {...register("slug")} />
            {formState.errors.slug && (
              <p className="mt-1 text-xs text-destructive">{formState.errors.slug.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...register("description")} />
          </div>
          <Button type="submit" disabled={createOrg.isPending}>
            {createOrg.isPending ? "Creating…" : "Create organization"}
          </Button>
        </form>

        <div className="mt-6 rounded-lg border border-dashed p-4 text-sm">
          <p className="font-medium">Have an invitation?</p>
          <p className="mt-1 text-muted-foreground">
            Open the invitation link you received — it will bring you to a join page.
          </p>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Your organizations</h2>
        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : memberships.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {memberships.map((m) => {
              const isCurrent = m.organization.id === currentOrgId;
              const canManage = m.role === "owner" || m.role === "admin";
              return (
                <li key={m.organization.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{m.organization.name}</p>
                        {isCurrent && <Badge variant="secondary">Current</Badge>}
                        {m.organization.status === "suspended" && (
                          <Badge variant="destructive">Suspended</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        /{m.organization.slug} · {m.role}
                      </p>
                      {m.organization.description && (
                        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                          {m.organization.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!isCurrent && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCurrentOrgId(m.organization.id)}
                      >
                        Switch
                      </Button>
                    )}
                    {canManage && (
                      <>
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            to="/organizations/$slug/settings"
                            params={{ slug: m.organization.slug }}
                          >
                            <Settings2 className="mr-1 h-3.5 w-3.5" /> Settings
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            to="/organizations/$slug/members"
                            params={{ slug: m.organization.slug }}
                          >
                            <Users className="mr-1 h-3.5 w-3.5" /> Members
                          </Link>
                        </Button>
                      </>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive">
                          Leave
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Leave {m.organization.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            You'll lose access to this organization's data. If you're the last
                            owner, you must transfer ownership first.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => leaveOrg.mutate(m.organization.id)}>
                            Leave
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            You don't belong to any organization yet. Create one to get started.
          </p>
        )}
      </section>
    </div>
  );
}
