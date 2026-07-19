import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { teamSchema, type TeamValues } from "@/lib/auth-schemas";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Trash2,
  UserPlus,
  Download,
  Users,
  Folder,
  CalendarDays,
  ImagePlus,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useServerFn } from "@tanstack/react-start";
import {
  getTeamStats,
  getTeamActivity,
  bulkAddTeamMembers,
  bulkRemoveTeamMembers,
  updateTeamAvatar,
  archiveTeam,
  restoreTeam,
} from "@/lib/teams.functions";

type OrgMemberRow = {
  user_id: string;
  role: string;
  profile: { full_name: string | null } | null;
};

export const Route = createFileRoute("/_authenticated/teams/$teamId")({
  component: TeamDetail,
});

function TeamDetail() {
  const { teamId } = useParams({ from: "/_authenticated/teams/$teamId" });
  const { user } = useSession();
  const { currentMembership } = useCurrentOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");

  const team = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("id", teamId)
        .maybeSingle();
      if (error) throw error;
      return data as (typeof data & { avatar_url: string | null }) | null;
    },
  });

  const getStatsFn = useServerFn(getTeamStats);
  const getActivityFn = useServerFn(getTeamActivity);
  const bulkAddFn = useServerFn(bulkAddTeamMembers);
  const bulkRemoveFn = useServerFn(bulkRemoveTeamMembers);
  const updateAvatarFn = useServerFn(updateTeamAvatar);
  const archiveFn = useServerFn(archiveTeam);
  const restoreFn = useServerFn(restoreTeam);

  const stats = useQuery({
    enabled: !!team.data,
    queryKey: ["team-stats", teamId],
    queryFn: () => getStatsFn({ data: { teamId } }),
  });

  const activity = useQuery({
    enabled: !!team.data,
    queryKey: ["team-activity", teamId],
    queryFn: () => getActivityFn({ data: { teamId, limit: 50 } }),
  });

  const projects = useQuery({
    enabled: !!team.data,
    queryKey: ["team-projects", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, slug, status, due_date, created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });


  const inSameOrg = team.data?.organization_id === currentMembership?.organization.id;
  const isOwner = team.data?.owner_id === user?.id;
  const canManage =
    !!team.data &&
    (isOwner ||
      (inSameOrg && (currentMembership?.role === "owner" || currentMembership?.role === "admin")));

  const members = useQuery({
    enabled: !!team.data,
    queryKey: ["team-members", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("id, user_id, role, created_at")
        .eq("team_id", teamId)
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

  const orgMembers = useQuery({
    enabled: !!team.data,
    queryKey: ["org-members-for-team", team.data?.organization_id],
    queryFn: async (): Promise<OrgMemberRow[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", team.data!.organization_id);
      if (error) throw error;
      const ids = (data ?? []).map((m) => m.user_id);
      let profiles: Record<string, { full_name: string | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        profiles = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      }
      return (data ?? []).map((m) => ({ ...m, profile: profiles[m.user_id] ?? null }));
    },
  });

  // Realtime for members / activity / team
  useEffect(() => {
    if (!team.data) return;
    const ch = supabase
      .channel(`team-${teamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_members", filter: `team_id=eq.${teamId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["team-members", teamId] });
          qc.invalidateQueries({ queryKey: ["team-stats", teamId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "teams", filter: `id=eq.${teamId}` },
        () => qc.invalidateQueries({ queryKey: ["team", teamId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [team.data, teamId, qc]);

  const { register, handleSubmit, reset, formState } = useForm<TeamValues>({
    resolver: zodResolver(teamSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  useEffect(() => {
    if (team.data) {
      reset({
        name: team.data.name,
        slug: team.data.slug,
        description: team.data.description ?? "",
      });
    }
  }, [team.data, reset]);

  const save = useMutation({
    mutationFn: async (v: TeamValues) => {
      const { error } = await supabase
        .from("teams")
        .update({ name: v.name, slug: v.slug, description: v.description || null })
        .eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team updated");
      qc.invalidateQueries({ queryKey: ["team", teamId] });
      qc.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [ownerCandidate, setOwnerCandidate] = useState<string>("");
  const transferOwner = useMutation({
    mutationFn: async (newOwner: string) => {
      const { error } = await supabase
        .from("teams")
        .update({ owner_id: newOwner })
        .eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ownership transferred");
      qc.invalidateQueries({ queryKey: ["team", teamId] });
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
      setOwnerCandidate("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("teams").delete().eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Team deleted");
      qc.invalidateQueries({ queryKey: ["teams"] });
      navigate({ to: "/teams" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: async (archive: boolean) => archiveFn({ data: { teamId, archive } }),
    onSuccess: (_d, archive) => {
      toast.success(archive ? "Team archived" : "Team unarchived");
      qc.invalidateQueries({ queryKey: ["team", teamId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMut = useMutation({
    mutationFn: async () => restoreFn({ data: { teamId } }),
    onSuccess: () => {
      toast.success("Team restored");
      qc.invalidateQueries({ queryKey: ["team", teamId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [addUser, setAddUser] = useState<string>("");
  const addMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("team_members").insert({
        team_id: teamId,
        user_id: userId,
        role: "member",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member added");
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
      setAddUser("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("team_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member removed");
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeRole = useMutation({
    mutationFn: async (v: { id: string; role: "member" | "owner" }) => {
      const { error } = await supabase
        .from("team_members")
        .update({ role: v.role })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const bulkAdd = useMutation({
    mutationFn: (userIds: string[]) => bulkAddFn({ data: { teamId, userIds } }),
    onSuccess: (r) => {
      toast.success(`Added ${r.added} member(s)`);
      setSelected({});
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
      qc.invalidateQueries({ queryKey: ["team-stats", teamId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const bulkRemove = useMutation({
    mutationFn: (userIds: string[]) => bulkRemoveFn({ data: { teamId, userIds } }),
    onSuccess: (r) => {
      toast.success(`Removed ${r.removed} member(s)`);
      setSelected({});
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
      qc.invalidateQueries({ queryKey: ["team-stats", teamId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [uploading, setUploading] = useState(false);
  const uploadAvatar = async (file: File) => {
    if (!team.data) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const path = `${team.data.organization_id}/${team.data.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("team-avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage
        .from("team-avatars")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      const url = signed?.signedUrl ?? null;
      await updateAvatarFn({ data: { teamId, avatarUrl: url } });
      toast.success("Avatar updated");
      qc.invalidateQueries({ queryKey: ["team", teamId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const exportCsv = () => {
    const rows = (members.data ?? []).map((m) => ({
      user_id: m.user_id,
      full_name: m.profile?.full_name ?? "",
      role: m.role,
      joined_at: m.created_at,
    }));
    const cols = ["user_id", "full_name", "role", "joined_at"];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => esc(String(r[c as keyof typeof r] ?? ""))).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `team-${team.data?.slug ?? teamId}-members.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Drag-and-drop: drag an org member from the "Available" list to the members list.
  const [dragUser, setDragUser] = useState<string | null>(null);
  const onDropAdd = (e: React.DragEvent) => {
    e.preventDefault();
    const uid = e.dataTransfer.getData("text/user-id") || dragUser;
    if (uid) addMember.mutate(uid);
    setDragUser(null);
  };

  if (team.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!team.data) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Team not found</h2>
        <Link to="/teams" className="mt-4 inline-block text-sm underline">
          Back to teams
        </Link>
      </div>
    );
  }

  const memberIds = new Set(members.data?.map((m) => m.user_id) ?? []);
  const availableToAdd = (orgMembers.data ?? []).filter((m) => !memberIds.has(m.user_id));
  const selectedIds = Object.entries(selected)
    .filter(([k, v]) => v && !k.startsWith("add:"))
    .map(([k]) => k);
  const isArchived = !!team.data.archived_at;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        {team.data.avatar_url ? (
          <img
            src={team.data.avatar_url}
            alt=""
            className="h-16 w-16 rounded-lg border object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-muted text-lg font-semibold text-muted-foreground">
            {team.data.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <Link to="/teams" className="text-sm text-muted-foreground hover:underline">
            ← All teams
          </Link>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{team.data.name}</h1>
            {isArchived && <Badge variant="outline">Archived</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">/{team.data.slug}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Members" icon={<Users className="h-4 w-4" />}>
              {stats.data?.member_count ?? "—"}
            </StatCard>
            <StatCard label="Projects" icon={<Folder className="h-4 w-4" />}>
              {stats.data?.project_count ?? "—"}
            </StatCard>
            <StatCard label="Created" icon={<CalendarDays className="h-4 w-4" />}>
              {stats.data ? new Date(stats.data.created_at).toLocaleDateString() : "—"}
            </StatCard>
          </div>
          <section className="rounded-xl border bg-card p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              About this team
            </h2>
            <p className="mt-2 text-sm">
              {team.data.description || "No description provided."}
            </p>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Team lead: </span>
                <span className="font-medium">
                  {members.data?.find((m) => m.user_id === team.data!.owner_id)?.profile
                    ?.full_name ?? "Unassigned"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Status: </span>
                <span className="font-medium">{isArchived ? "Archived" : "Active"}</span>
              </div>
            </div>
          </section>
        </TabsContent>

        {/* Members */}
        <TabsContent value="members" className="space-y-4">
          <section className="rounded-xl border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Members</h2>
              <div className="flex items-center gap-2">
                {canManage && selectedIds.length > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={bulkRemove.isPending}
                    onClick={() => bulkRemove.mutate(selectedIds)}
                  >
                    Remove {selectedIds.length}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={exportCsv}>
                  <Download className="mr-1 h-4 w-4" /> CSV
                </Button>
              </div>
            </div>

            <div
              onDragOver={(e) => canManage && e.preventDefault()}
              onDrop={canManage ? onDropAdd : undefined}
              className={
                canManage
                  ? "mt-4 rounded-md border border-dashed border-transparent transition-colors [&.drag-over]:border-primary [&.drag-over]:bg-primary/5"
                  : "mt-4"
              }
            >
              {members.isLoading ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (members.data ?? []).length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No members yet.
                  {canManage && " Drag someone from Available below or use Add."}
                </p>
              ) : (
                <ul className="divide-y">
                  {members.data!.map((m) => {
                    const isSelf = m.user_id === user?.id;
                    const isTeamOwner = m.user_id === team.data!.owner_id;
                    return (
                      <li key={m.id} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                          {canManage && !isTeamOwner ? (
                            <Checkbox
                              checked={!!selected[m.user_id]}
                              onCheckedChange={(v) =>
                                setSelected((s) => ({ ...s, [m.user_id]: !!v }))
                              }
                            />
                          ) : (
                            <span className="h-4 w-4" />
                          )}
                          <div>
                            <p className="font-medium">
                              {m.profile?.full_name ?? m.user_id.slice(0, 8)}
                              {isSelf && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  (you)
                                </span>
                              )}
                              {isTeamOwner && (
                                <Badge className="ml-2" variant="default">
                                  Lead
                                </Badge>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Joined {new Date(m.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{m.role}</Badge>

                          {canManage && !isTeamOwner && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Remove"
                              onClick={() => removeMember.mutate(m.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {canManage && (
              <div className="mt-6 flex flex-wrap items-end gap-2 border-t pt-4">
                <div className="min-w-[220px] flex-1">
                  <Label>Add organization member</Label>
                  <Select value={addUser} onValueChange={setAddUser}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select member…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableToAdd.length === 0 && (
                        <SelectItem value="__none" disabled>
                          No available members
                        </SelectItem>
                      )}
                      {availableToAdd.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.profile?.full_name ?? m.user_id.slice(0, 8)} · {m.role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => addUser && addMember.mutate(addUser)}
                  disabled={!addUser || addMember.isPending}
                >
                  <UserPlus className="mr-1 h-4 w-4" /> Add
                </Button>
              </div>
            )}
          </section>

          {canManage && availableToAdd.length > 0 && (
            <section className="rounded-xl border bg-card p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Available in organization</h3>
                <p className="text-xs text-muted-foreground">
                  Drag onto the members list, or select to bulk add.
                </p>
              </div>
              <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded border p-2">
                {availableToAdd.map((m) => {
                  const key = `add:${m.user_id}`;
                  return (
                    <label
                      key={m.user_id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/user-id", m.user_id);
                        setDragUser(m.user_id);
                      }}
                      onDragEnd={() => setDragUser(null)}
                      className="flex cursor-grab items-center gap-2 rounded p-1 text-sm hover:bg-muted active:cursor-grabbing"
                    >
                      <Checkbox
                        checked={!!selected[key]}
                        onCheckedChange={(v) =>
                          setSelected((s) => ({ ...s, [key]: !!v }))
                        }
                      />
                      <span className="flex-1">
                        {m.profile?.full_name ?? m.user_id.slice(0, 8)}
                      </span>
                      <span className="text-xs text-muted-foreground">{m.role}</span>
                    </label>
                  );
                })}
              </div>
              <Button
                size="sm"
                className="mt-3"
                disabled={
                  bulkAdd.isPending ||
                  !Object.keys(selected).some((k) => k.startsWith("add:") && selected[k])
                }
                onClick={() =>
                  bulkAdd.mutate(
                    Object.keys(selected)
                      .filter((k) => k.startsWith("add:") && selected[k])
                      .map((k) => k.slice(4)),
                  )
                }
              >
                Add selected
              </Button>
            </section>
          )}
        </TabsContent>

        {/* Projects */}
        <TabsContent value="projects">
          <section className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold">Projects</h2>
            {projects.isLoading ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : (projects.data ?? []).length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No projects assigned to this team yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y">
                {projects.data!.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.due_date
                          ? `Due ${new Date(p.due_date).toLocaleDateString()}`
                          : "No due date"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="capitalize">
                        {p.status}
                      </Badge>
                    </div>

                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity">
          <section className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold">Recent activity</h2>
            {activity.isLoading ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : activity.data && activity.data.length ? (
              <ul className="mt-4 space-y-3">
                {activity.data.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start justify-between gap-3 border-l-2 border-primary/40 pl-3"
                  >
                    <div>
                      <p className="text-sm">{a.summary}</p>
                      <p className="text-xs text-muted-foreground">{a.action}</p>
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>
            )}
          </section>
        </TabsContent>

        {/* Settings */}
        <TabsContent value="settings" className="space-y-4">
          <section className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold">General</h2>
            {canManage ? (
              <form onSubmit={handleSubmit((v) => save.mutate(v))} className="mt-4 space-y-4">
                <div className="flex items-center gap-4">
                  {team.data.avatar_url ? (
                    <img
                      src={team.data.avatar_url}
                      alt=""
                      className="h-14 w-14 rounded-lg border object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg border bg-muted text-sm font-semibold text-muted-foreground">
                      {team.data.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                    <ImagePlus className="h-4 w-4" />
                    {uploading ? "Uploading…" : "Upload avatar"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadAvatar(f);
                      }}
                    />
                  </label>
                </div>
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" {...register("name")} />
                  {formState.errors.name && (
                    <p className="mt-1 text-xs text-destructive">
                      {formState.errors.name.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" {...register("slug")} />
                  {formState.errors.slug && (
                    <p className="mt-1 text-xs text-destructive">
                      {formState.errors.slug.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" rows={3} {...register("description")} />
                </div>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
              </form>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Only the team lead or organization admins can edit settings.
              </p>
            )}
          </section>

          {canManage && (
            <section className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">Transfer lead</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Move the team-lead role to another member.
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <Select value={ownerCandidate} onValueChange={setOwnerCandidate}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select member…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(members.data ?? [])
                        .filter((m) => m.user_id !== team.data!.owner_id)
                        .map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {m.profile?.full_name ?? m.user_id.slice(0, 8)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={!ownerCandidate || transferOwner.isPending}
                  onClick={() => transferOwner.mutate(ownerCandidate)}
                >
                  Transfer
                </Button>
              </div>
            </section>
          )}

          {canManage && (
            <section className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">Archive</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isArchived
                  ? "This team is archived. Restore it to make it active again."
                  : "Archive to hide the team from active lists without deleting it."}
              </p>
              <div className="mt-4">
                {isArchived ? (
                  <Button
                    variant="outline"
                    onClick={() => restoreMut.mutate()}
                    disabled={restoreMut.isPending}
                  >
                    <ArchiveRestore className="mr-1 h-4 w-4" /> Restore team
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => archiveMut.mutate(true)}
                    disabled={archiveMut.isPending}
                  >
                    <Archive className="mr-1 h-4 w-4" /> Archive team
                  </Button>
                )}
              </div>
            </section>
          )}

          {isOwner && (
            <section className="rounded-xl border border-destructive/40 bg-card p-6">
              <h2 className="text-lg font-semibold text-destructive">Delete team</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Removes the team and all memberships. This can't be undone.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="mt-4">
                    Delete team
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {team.data.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      All team memberships will be lost.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => del.mutate()}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <p className="mt-2 text-2xl font-bold">{children}</p>
    </div>
  );
}
