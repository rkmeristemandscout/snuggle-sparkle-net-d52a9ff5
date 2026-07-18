import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/invitations")({
  component: InvitationsInbox,
});

type Invite = {
  id: string;
  email: string;
  role: string;
  token: string;
  accepted_at: string | null;
  rejected_at: string | null;
  expires_at: string;
  organization_id: string;
  organization?: { name: string; slug: string } | null;
};

function statusOf(inv: Invite) {
  if (inv.accepted_at) return "accepted";
  if (inv.rejected_at) return "rejected";
  if (new Date(inv.expires_at) < new Date()) return "expired";
  return "pending";
}

function InvitationsInbox() {
  const { user } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const invites = useQuery({
    enabled: !!user,
    queryKey: ["my-invitations", user?.email],
    queryFn: async (): Promise<Invite[]> => {
      const { data, error } = await supabase
        .from("organization_invitations")
        .select("id, email, role, token, accepted_at, rejected_at, expires_at, organization_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []).filter(
        (r) => r.email.toLowerCase() === (user?.email ?? "").toLowerCase(),
      );
      const orgIds = Array.from(new Set(rows.map((r) => r.organization_id)));
      let orgs: Record<string, { name: string; slug: string }> = {};
      if (orgIds.length) {
        const { data: os } = await supabase
          .from("organizations")
          .select("id, name, slug")
          .in("id", orgIds);
        orgs = Object.fromEntries((os ?? []).map((o) => [o.id, o]));
      }
      return rows.map((r) => ({ ...r, organization: orgs[r.organization_id] ?? null }));
    },
  });

  const accept = useMutation({
    mutationFn: async (token: string) => {
      const { data, error } = await supabase.rpc("accept_invitation", { _token: token });
      if (error) throw error;
      return data;
    },
    onSuccess: (org) => {
      const created = Array.isArray(org) ? org[0] : org;
      toast.success(`Joined ${created?.name ?? "organization"}`);
      if (created?.id) window.localStorage.setItem("stackly.currentOrgId", created.id);
      qc.invalidateQueries({ queryKey: ["memberships"] });
      qc.invalidateQueries({ queryKey: ["my-invitations"] });
      navigate({ to: "/dashboard" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async (token: string) => {
      const { error } = await supabase.rpc("reject_invitation", { _token: token });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invitation rejected");
      qc.invalidateQueries({ queryKey: ["my-invitations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invitations</h1>
        <p className="text-sm text-muted-foreground">Invitations sent to {user?.email}.</p>
      </div>
      <section className="rounded-xl border bg-card p-6">
        {invites.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : invites.data && invites.data.length > 0 ? (
          <ul className="divide-y">
            {invites.data.map((inv) => {
              const status = statusOf(inv);
              return (
                <li key={inv.id} className="flex items-center justify-between py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {inv.organization?.name ?? "Organization"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Role: {inv.role} · Expires {new Date(inv.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        status === "pending"
                          ? "secondary"
                          : status === "accepted"
                            ? "default"
                            : "destructive"
                      }
                    >
                      {status}
                    </Badge>
                    {status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => accept.mutate(inv.token)}
                          disabled={accept.isPending}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reject.mutate(inv.token)}
                          disabled={reject.isPending}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No invitations.</p>
        )}
      </section>
    </div>
  );
}
