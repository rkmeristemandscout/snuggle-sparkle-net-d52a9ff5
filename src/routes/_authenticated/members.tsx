import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Copy, MoreHorizontal, Search, Trash2, UserPlus,
  UserCheck, UserX, Users, UserRound, MailWarning,
  MailX, Check, X as XIcon,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getInvitationEmailStatus, sendInvitationEmail, sendTestInvitationEmail } from "@/lib/invitations.functions";
import OrgInvitationTemplate from "@/lib/email-templates/organization-invitation";
const OrgInvitationEmail = OrgInvitationTemplate.component;

import { supabase } from "@/integrations/supabase/client";
import { useCurrentOrg, type OrgRole } from "@/hooks/use-current-org";
import { useSession } from "@/hooks/use-session";
import { usePermissions } from "@/hooks/use-permissions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
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

type Status = "active" | "suspended" | "pending" | "expired" | "rejected";

type Row = {
  key: string;
  kind: "member" | "invitation";
  id: string;
  userId: string | null;
  fullName: string;
  email: string;
  role: string;
  status: Status;
  department: string;
  teams: string[];
  joinedAt: string;
  lastActive: string | null;
  avatarUrl: string | null;
  token?: string | null;
  expiresAt?: string | null;
};

type MemberRpcRow = {
  id: string;
  user_id: string;
  role: OrgRole;
  status: "active" | "suspended";
  created_at: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  last_sign_in_at: string | null;
  department_id: string | null;
  department_name: string | null;
  team_names: string[] | null;
};

const RBAC_ROLES = [
  { key: "organization_owner", label: "Organization Owner", orgRole: "admin" as OrgRole },
  { key: "admin", label: "Admin", orgRole: "admin" as OrgRole },
  { key: "manager", label: "Manager", orgRole: "member" as OrgRole },
  { key: "employee", label: "Employee", orgRole: "member" as OrgRole },
  { key: "guest", label: "Guest", orgRole: "member" as OrgRole },
];

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  roleKey: z.enum(["organization_owner", "admin", "manager", "employee", "guest"]),
});
type InviteFormValues = z.infer<typeof inviteSchema>;

function initials(name: string, email: string) {
  const src = name?.trim() || email || "?";
  return src.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
}

function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function timeUntil(iso: string | null | undefined): { label: string; expired: boolean } {
  if (!iso) return { label: "", expired: false };
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return { label: "Expired", expired: true };
  const m = Math.floor(diff / 60000);
  if (m < 60) return { label: `${m}m left`, expired: false };
  const h = Math.floor(m / 60);
  if (h < 24) return { label: `${h}h left`, expired: false };
  const d = Math.floor(h / 24);
  return { label: `${d}d left`, expired: false };
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
  const [previewOpen, setPreviewOpen] = useState(false);

  const fetchEmailStatus = useServerFn(getInvitationEmailStatus);
  const emailStatusQuery = useQuery({
    queryKey: ["members-page", "email-status"],
    queryFn: () => fetchEmailStatus(),
    staleTime: 5 * 60 * 1000,
    enabled: !!currentMembership,
  });
  const emailConfigured = emailStatusQuery.data?.configured ?? true;

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/join/${token}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success("Invite link copied", { description: url }),
      () => toast.error("Couldn't copy — copy manually", { description: url })
    );
  };
  const copyInviteToken = (token: string) => {
    navigator.clipboard.writeText(token).then(
      () => toast.success("Invitation token copied"),
      () => toast.error("Couldn't copy token")
    );
  };

  const members = useQuery({
    enabled: !!currentOrgId,
    queryKey: ["members-page", "members", currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_org_members", { _org: currentOrgId! });
      if (error) throw error;
      return (data ?? []) as MemberRpcRow[];
    },
  });

  const invites = useQuery({
    enabled: !!currentOrgId && !!canManage,
    queryKey: ["members-page", "invites", currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_invitations")
        .select("id, email, role, token, accepted_at, rejected_at, expires_at, created_at, assigned_role_key")
        .eq("organization_id", currentOrgId!)
        .is("accepted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Realtime refresh
  useEffect(() => {
    if (!currentOrgId) return;
    const ch = supabase
      .channel(`members-page-${currentOrgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "organization_members", filter: `organization_id=eq.${currentOrgId}` },
        () => qc.invalidateQueries({ queryKey: ["members-page", "members", currentOrgId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "organization_invitations", filter: `organization_id=eq.${currentOrgId}` },
        () => qc.invalidateQueries({ queryKey: ["members-page", "invites", currentOrgId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentOrgId, qc]);

  const rows: Row[] = useMemo(() => {
    const memberRows: Row[] = (members.data ?? []).map((m) => ({
      key: `m-${m.id}`,
      kind: "member",
      id: m.id,
      userId: m.user_id,
      fullName: m.full_name ?? "—",
      email: m.email ?? "",
      role: m.role,
      status: m.status,
      department: m.department_name ?? "—",
      teams: m.team_names ?? [],
      joinedAt: m.created_at,
      lastActive: m.last_sign_in_at,
      avatarUrl: m.avatar_url,
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
        role: (i as { assigned_role_key?: string | null }).assigned_role_key ?? i.role,
        status,
        department: "—",
        teams: [],
        joinedAt: i.created_at,
        lastActive: null,
        avatarUrl: null,
        token: i.token,
        expiresAt: i.expires_at,
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

  const stats = useMemo(() => {
    const memberList = members.data ?? [];
    const inviteList = invites.data ?? [];
    return {
      total: memberList.length,
      active: memberList.filter((m) => m.status === "active").length,
      pending: inviteList.filter((i) => !i.rejected_at && new Date(i.expires_at) >= new Date()).length,
    };
  }, [members.data, invites.data]);

  const invite = useMutation({
    mutationFn: async (v: InviteFormValues) => {
      if (!currentOrgId || !user) throw new Error("Missing context");
      const orgRole = RBAC_ROLES.find((r) => r.key === v.roleKey)!.orgRole;
      const { data, error } = await supabase.rpc("create_invitation", {
        _org: currentOrgId,
        _email: v.email,
        _role: orgRole,
        _role_key: v.roleKey,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const token = row?.token as string;

      let emailStatus: "sent" | "not_configured" | "failed" = "not_configured";
      try {
        const { sendInvitationEmail } = await import("@/lib/invitations.functions");
        const res = await sendInvitationEmail({
          data: {
            email: v.email,
            token,
            organizationId: currentOrgId,
            inviterName: user.email ?? undefined,
          },
        });
        emailStatus = res?.sent ? "sent" : res?.reason === "not_configured" ? "not_configured" : "failed";
      } catch {
        emailStatus = "failed";
      }
      return { token, emailStatus };
    },
    onSuccess: ({ token, emailStatus }) => {
      const url = `${window.location.origin}/join/${token}`;
      navigator.clipboard?.writeText(url).catch(() => {});
      if (emailStatus === "sent") {
        toast.success("Invitation sent", { description: "Email delivered. Link also copied to clipboard." });
      } else if (emailStatus === "not_configured") {
        toast.success("Invitation created", {
          description: "Email delivery isn't configured yet — invite link copied. Set up an email domain to send automatically.",
        });
      } else {
        toast.warning("Invitation created, email failed", {
          description: "We couldn't send the email. Invite link copied to clipboard — share it manually.",
        });
      }
      setInviteOpen(false);
      qc.invalidateQueries({ queryKey: ["members-page", "invites", currentOrgId] });
    },
    onError: (e: Error) => {
      const msg = e.message || "Failed to create invitation";
      if (/already a member/i.test(msg)) {
        toast.error("Already a member", { description: "This person is already part of your organization." });
      } else if (/active invitation already exists/i.test(msg)) {
        toast.error("Invitation pending", {
          description: "An active invitation already exists for this email. Resend or cancel it from the list.",
        });
      } else if (/Insufficient permissions/i.test(msg)) {
        toast.error("Not allowed", { description: "You don't have permission to invite members." });
      } else if (/Invalid email/i.test(msg)) {
        toast.error("Invalid email", { description: "Please enter a valid email address." });
      } else if (/Invalid role/i.test(msg)) {
        toast.error("Invalid role", { description: "Pick a valid role for this invitation." });
      } else {
        toast.error(msg);
      }
    },
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

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "suspended" }) => {
      const { error } = await supabase.rpc("set_member_status", { _member_id: id, _status: status });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.status === "suspended" ? "Member suspended" : "Member activated");
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

  const sendInvite = useServerFn(sendInvitationEmail);
  const resend = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("resend_invitation", { _invitation_id: id });
      if (error) throw error;
      // Fetch the refreshed token/email/expiry after regeneration.
      const { data: row, error: fetchErr } = await supabase
        .from("organization_invitations")
        .select("id, email, token, expires_at")
        .eq("id", id)
        .single();
      if (fetchErr) throw fetchErr;
      return row;
    },
    onSuccess: async (row) => {
      qc.invalidateQueries({ queryKey: ["members-page", "invites", currentOrgId] });
      if (!row?.token) {
        toast.success("Invitation refreshed");
        return;
      }
      if (emailConfigured && row.email && currentOrgId) {
        try {
          const result = await sendInvite({
            data: {
              email: row.email,
              token: row.token,
              organizationId: currentOrgId,
              inviterName: user?.email ?? undefined,
            },
          });
          if (result?.sent) {
            toast.success("Invitation email resent", { description: row.email });
            return;
          }
          // Fall through to clipboard fallback on any non-sent result.
        } catch {
          // network / server error — fall back to link copy
        }
      }
      // Not configured (or send failed) → refresh link and copy it.
      copyInviteLink(row.token);
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              <MailWarning className="mr-2 h-4 w-4" /> Preview email
            </Button>
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" /> Invite Member
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={Users} label="Total Members" value={stats.total} />
        <StatCard icon={UserRound} label="Active Members" value={stats.active} />
        <StatCard icon={MailWarning} label="Pending Invitations" value={stats.pending} />
      </div>

      {canManage && <EmailDeliveryBanner />}

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
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="guest">Guest</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]"></TableHead>
              <TableHead>Full Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.isLoading || (canManage && invites.isLoading) ? (
              <TableRow><TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">No members match your filters.</TableCell></TableRow>
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
                      {r.kind === "invitation" && r.token && !emailConfigured && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2 h-6 px-2 text-xs"
                          onClick={() => copyInviteLink(r.token!)}
                        >
                          <Copy className="mr-1 h-3 w-3" /> Copy link
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.department}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.teams.length === 0 ? "—" : r.teams.length === 1 ? r.teams[0] : `${r.teams[0]} +${r.teams.length - 1}`}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(r.joinedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.kind === "member" ? timeAgo(r.lastActive) : "—"}
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
                              <>
                                <DropdownMenuItem onClick={() => copyInviteLink(r.token!)}>
                                  <Copy className="mr-2 h-4 w-4" /> Copy invite link
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => copyInviteToken(r.token!)}>
                                  <Copy className="mr-2 h-4 w-4" /> Copy invite token
                                </DropdownMenuItem>
                              </>
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
                              <>
                                {r.status === "active" ? (
                                  <DropdownMenuItem onClick={() => setStatus.mutate({ id: r.id, status: "suspended" })}>
                                    <UserX className="mr-2 h-4 w-4" /> Suspend member
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => setStatus.mutate({ id: r.id, status: "active" })}>
                                    <UserCheck className="mr-2 h-4 w-4" /> Activate member
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => removeMember.mutate(r.id)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Remove member
                                </DropdownMenuItem>
                              </>
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

      <PreviewEmailDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        defaultOrgName={currentMembership?.organization.name ?? "Acme Inc."}
        defaultInviterName={(user?.user_metadata?.full_name as string | undefined) ?? "Jane Doe"}
        emailConfigured={emailConfigured}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmailDeliveryBanner() {
  const fetchStatus = useServerFn(getInvitationEmailStatus);
  const status = useQuery({
    queryKey: ["members-page", "email-status"],
    queryFn: () => fetchStatus(),
    staleTime: 5 * 60 * 1000,
  });

  if (status.isLoading || !status.data || status.data.configured) return null;
  const { checks } = status.data;

  const items = [
    { ok: checks.lovableKey, label: "Server email API key available" },
    { ok: checks.emailHelper, label: "Verified sender domain configured" },
    { ok: checks.invitationTemplate, label: "Invitation email template registered" },
  ];

  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-500/15 p-2 text-amber-700 dark:text-amber-300">
          <MailX className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-2">
          <div>
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              Email delivery is not configured
            </p>
            <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
              Invitations are still created and the join link is copied to your clipboard,
              but no email is sent automatically. Complete the checklist below to enable delivery.
            </p>
          </div>
          <ul className="space-y-1 text-xs text-amber-900 dark:text-amber-100">
            {items.map((it) => (
              <li key={it.label} className="flex items-center gap-2">
                {it.ok ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <XIcon className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
                )}
                <span className={it.ok ? "line-through opacity-70" : ""}>{it.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-amber-800/80 dark:text-amber-200/70">
            Once a sender domain is set up in Cloud → Emails, the invitation template
            activates automatically and this banner disappears.
          </p>
        </div>
      </div>
    </div>
  );
}

function InviteDialog({
  open, onOpenChange, pending, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: boolean;
  onSubmit: (v: InviteFormValues) => void;
}) {
  const { register, handleSubmit, reset, setValue, watch, formState } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", roleKey: "employee" },
  });
  const roleKey = watch("roleKey");

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
            <Select value={roleKey} onValueChange={(r) => setValue("roleKey", r as InviteFormValues["roleKey"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RBAC_ROLES.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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

function PreviewEmailDialog({
  open,
  onOpenChange,
  defaultOrgName,
  defaultInviterName,
  emailConfigured,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultOrgName: string;
  defaultInviterName: string;
  emailConfigured: boolean;
}) {
  const [orgName, setOrgName] = useState(defaultOrgName);
  const [inviterName, setInviterName] = useState(defaultInviterName);
  const [inviteUrl, setInviteUrl] = useState(
    typeof window !== "undefined"
      ? `${window.location.origin}/invitations/accept?token=preview-token-123`
      : "https://example.com/invitations/accept?token=preview-token-123"
  );
  const [testEmail, setTestEmail] = useState("");

  const sendTest = useServerFn(sendTestInvitationEmail);
  const testMutation = useMutation({
    mutationFn: (email: string) =>
      sendTest({ data: { email, organizationName: orgName, inviterName, inviteUrl } }),
    onSuccess: (res) => {
      if (res?.sent) {
        toast.success("Test email sent", { description: `Delivered to ${testEmail}` });
      } else if (res?.reason === "suppressed") {
        toast.error("Recipient is suppressed", {
          description: "This address previously bounced, complained, or unsubscribed.",
        });
      } else if (res?.reason === "not_configured") {
        toast.error("Email delivery is not configured");
      } else {
        toast.error("Couldn't send test email", { description: res?.detail });
      }
    },
    onError: (err: any) => toast.error("Couldn't send test email", { description: err?.message }),
  });

  useEffect(() => {
    if (open) {
      setOrgName(defaultOrgName);
      setInviterName(defaultInviterName);
    }
  }, [open, defaultOrgName, defaultInviterName]);

  const subject = `You're invited to join ${orgName}`;
  const previewText = `${inviterName || "A teammate"} invited you to join ${orgName}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Invitation email preview</DialogTitle>
          <DialogDescription>
            Rendered with sample data. Update the fields to see the subject, preview text, and CTA
            link update in real time.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="preview-org">Organization</Label>
            <Input id="preview-org" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="preview-inviter">Inviter</Label>
            <Input
              id="preview-inviter"
              value={inviterName}
              onChange={(e) => setInviterName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="preview-url">Invite URL</Label>
            <Input
              id="preview-url"
              value={inviteUrl}
              onChange={(e) => setInviteUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-2">
          <CopyableRow label="Subject" value={subject} />
          <CopyableRow label="Preview text" value={previewText} />
          <CopyableRow label="CTA link" value={inviteUrl} />
        </div>

        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="max-h-[420px] overflow-auto">
            <OrgInvitationEmail
              organizationName={orgName}
              inviteUrl={inviteUrl}
              inviterName={inviterName}
            />
          </div>
        </div>

        <div className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Send test email</p>
              <p className="text-xs text-muted-foreground">
                Delivers this rendered template to a real inbox so you can verify it end-to-end.
              </p>
            </div>
          </div>
          {!emailConfigured && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <MailX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Email delivery isn't configured yet, so test sends are disabled. Set up a verified
                sender domain in Cloud → Emails to enable this.
              </span>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="preview-test-email"
              type="email"
              placeholder="you@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              disabled={!emailConfigured || testMutation.isPending}
              autoComplete="email"
            />
            <Button
              type="button"
              onClick={() => {
                const email = testEmail.trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  toast.error("Enter a valid email address");
                  return;
                }
                testMutation.mutate(email);
              }}
              disabled={!emailConfigured || testMutation.isPending || !testEmail.trim()}
            >
              {testMutation.isPending ? "Sending…" : "Send test email"}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyableRow({ label, value }: { label: string; value: string }) {
  const onCopy = () => {
    navigator.clipboard.writeText(value).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Couldn't copy ${label.toLowerCase()}`)
    );
  };
  return (
    <div className="flex items-start gap-2">
      <span className="font-medium text-muted-foreground shrink-0">{label}:</span>
      <span className="font-mono break-all flex-1">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={onCopy}
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
