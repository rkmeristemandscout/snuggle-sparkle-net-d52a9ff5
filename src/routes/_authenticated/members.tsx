import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Copy, MoreHorizontal, Search, Trash2, UserPlus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { inviteSchema, type InviteValues } from "@/lib/auth-schemas";
import { useCurrentOrg, type OrgRole } from "@/hooks/use-current-org";
import { useSession } from "@/hooks/use-session";
import { usePermissions } from "@/hooks/use-permissions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/members")({
  component: MembersPage,
});

type Status = "active" | "pending" | "expired" | "rejected";

type Row = {
  key: string;
  kind: "member" | "invitation";
  id: string;
  userId: string | null;
  fullName: string;
  email: string;
  role: string;
  status: Status;
  joinedAt: string;
  avatarUrl: string | null;
  token?: string | null;
};

function initials(name: string, email: string) {
  const src = name?.trim() || email || "?";
  return src.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
}

function MembersPage() {
  const { user } = useSession();
  const { currentOrgId, currentMembership } = useCurrentOrg();
  const { can } = usePermissions();
  const qc = useQueryClient();

  const canManage =
    can(["org.manage_users", "org.invite_members"]) ||
    currentMembership?.role === "owner" ||
    currentMembership?.role === "admin";
  const isOwner = currentMembership?.role === "owner";

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [inviteOpen, setInviteOpen] = useState(false);

  const members = useQuery({
    enabled: !!currentOrgId,
    queryKey: ["members-page", "members", currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("id, user_id, role, created_at")
        .eq("organization_id", currentOrgId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const ids = Array.from(new Set((data ?? []).map((m) => m.user_id)));
      let profiles: Record<string, { full_name: string | null; avatar_url: string | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", ids);
        profiles = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      }
      return (data ?? []).map((m) => ({ ...m, profile: profiles[m.user_id] ?? null }));
    },
  });

  const invites = useQuery({
    enabled: !!currentOrgId && !!canManage,
    queryKey: ["members-page", "invites", currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_invitations")
        .select("id, email, role, token, accepted_at, rejected_at, expires_at, created_at")
        .eq("organization_id", currentOrgId!)
        .is("accepted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows: Row[] = useMemo(() => {
    const memberRows: Row[] = (members.data ?? []).map((m) => ({
      key: `m-${m.id}`,
      kind: "member",
      id: m.id,
      userId: m.user_id,
      fullName: m.profile?.full_name ?? "—",
      email: "",
      role: m.role,
      status: "active",
      joinedAt: m.created_at,
      avatarUrl: m.profile?.avatar_url ?? null,
    }));
    const inviteRows: Row[] = (invites.data ?? []).map((i) => {
      const status: Status = i.rejected_at
        ? "rejected"
        : new Date(i.expires_at) < new Date()
          ? "expired"
          : "pending";
      return {
        key: `i-${i.id}`,
        kind: "invitation",
        id: i.id,
        userId: null,
        fullName: "—",
        email: i.email,
        role: i.role,
        status,
        joinedAt: i.created_at,
        avatarUrl: null,
        token: i.token,
      };
    });
    return [...memberRows, ...inviteRows];
  }, [members.data, invites.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (roleFilter !== "all" && r.role !== roleFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q) {
        const hay = `${r.fullName} ${r.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, roleFilter, statusFilter]);

  const invite = useMutation({
    mutationFn: async (v: InviteValues) => {
      if (!currentOrgId || !user) throw new Error("Missing context");
      const { data, error } = await supabase.rpc("create_invitation", {
        _org: currentOrgId,
        _email: v.email,
        _role: v.role,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row?.token as string;
    },
    onSuccess: (token) => {
      const url = `${window.location.origin}/join/${token}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      toast.success("Invitation created", {
        description: "Invite link copied to clipboard. Share it with the invitee — email delivery isn't configured yet.",
      });
      setInviteOpen(false);
      qc.invalidateQueries({ queryKey: ["members-page", "invites", currentOrgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: OrgRole }) => {
      const { error } = await supabase.from("organization_members").update({ role }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["members-page", "members", currentOrgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member removed");
      qc.invalidateQueries({ queryKey: ["members-page", "members", currentOrgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resend = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("resend_invitation", { _invitation_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invitation resent");
      qc.invalidateQueries({ queryKey: ["members-page", "invites", currentOrgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelInvite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("organization_invitations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invitation cancelled");
      qc.invalidateQueries({ queryKey: ["members-page", "invites", currentOrgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentOrgId) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h1 className="text-lg font-semibold">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Select or create an organization to manage its members.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Members</h1>
          <p className="text-sm text-muted-foreground">
            People with access to {currentMembership?.organization.name ?? "this workspace"}.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" /> Invite Member
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="members-search"
            name="members-search"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="member">Member</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]"></TableHead>
              <TableHead>Full Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.isLoading || invites.isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No members match your filters.</TableCell></TableRow>
            ) : (
              filtered.map((r) => {
                const isSelf = r.userId && r.userId === user?.id;
                return (
                  <TableRow key={r.key}>
                    <TableCell>
                      <Avatar className="h-8 w-8">
                        {r.avatarUrl && <AvatarImage src={r.avatarUrl} alt="" />}
                        <AvatarFallback>{initials(r.fullName, r.email)}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.fullName}
                      {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.email || "—"}</TableCell>
                    <TableCell>
                      {r.kind === "member" && canManage && !isSelf ? (
                        <Select
                          value={r.role}
                          onValueChange={(v) => updateRole.mutate({ id: r.id, role: v as OrgRole })}
                        >
                          <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {isOwner && <SelectItem value="owner">Owner</SelectItem>}
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">{r.role}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "active" ? "default"
                          : r.status === "pending" ? "secondary"
                          : "destructive"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(r.joinedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {r.kind === "invitation" && r.token && (
                              <DropdownMenuItem
                                onClick={() => {
                                  navigator.clipboard.writeText(`${window.location.origin}/join/${r.token}`);
                                  toast.success("Invite link copied");
                                }}
                              >
                                <Copy className="mr-2 h-4 w-4" /> Copy invite link
                              </DropdownMenuItem>
                            )}
                            {r.kind === "invitation" && (
                              <>
                                <DropdownMenuItem onClick={() => resend.mutate(r.id)}>
                                  Resend invitation
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => cancelInvite.mutate(r.id)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Cancel invitation
                                </DropdownMenuItem>
                              </>
                            )}
                            {r.kind === "member" && !isSelf && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => removeMember.mutate(r.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Remove member
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        pending={invite.isPending}
        onSubmit={(v) => invite.mutate(v)}
      />
    </div>
  );
}

function InviteDialog({
  open, onOpenChange, pending, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: boolean;
  onSubmit: (v: InviteValues) => void;
}) {
  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "member" },
  });
  const role = watch("role");

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Member</DialogTitle>
          <DialogDescription>
            They'll receive an invitation link to join this organization.
          </DialogDescription>
        </DialogHeader>
        <form
          id="invite-member-form"
          onSubmit={handleSubmit((v) => onSubmit(v))}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="invite-email">Email Address</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="email"
              {...register("email")}
            />
            {formState.errors.email && (
              <p className="mt-1 text-xs text-destructive">{formState.errors.email.message}</p>
            )}
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(r) => setValue("role", r as "admin" | "member")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Owner, Manager, Employee and Guest roles are assigned from the Roles page after the member joins.
            </p>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="invite-member-form" disabled={pending}>
            {pending ? "Sending…" : "Send Invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
