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
import { Trash2, UserPlus, Download, Users, Folder, CalendarDays, ImagePlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useServerFn } from "@tanstack/react-start";
import {
  getTeamStats,
  getTeamActivity,
  bulkAddTeamMembers,
  bulkRemoveTeamMembers,
  updateTeamAvatar,
} from "@/lib/teams.functions";
import { Checkbox } from "@/components/ui/checkbox";

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

  const stats = useQuery({
    enabled: !!team.data,
    queryKey: ["team-stats", teamId],
    queryFn: () => getStatsFn({ data: { teamId } }),
  });

  const activity = useQuery({
    enabled: !!team.data,
    queryKey: ["team-activity", teamId],
    queryFn: () => getActivityFn({ data: { teamId, limit: 30 } }),
  });

  const inSameOrg = team.data?.organization_id === currentMembership?.organization.id;
  const canManage =
    !!team.data &&
    (team.data.owner_id === user?.id ||
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

  // Bulk selection / actions
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

  // Avatar upload
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

  if (team.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
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
  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);

  return (
    <div className="space-y-6">
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
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{team.data.name}</h1>
          <p className="text-sm text-muted-foreground">/{team.data.slug}</p>
        </div>
        {canManage && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
            <ImagePlus className="h-4 w-4" />
            {uploading ? "Uploading…" : "Avatar"}
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
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Users className="h-4 w-4" /> Members
          </div>
          <p className="mt-2 text-2xl font-bold">{stats.data?.member_count ?? "—"}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <Folder className="h-4 w-4" /> Projects
          </div>
          <p className="mt-2 text-2xl font-bold">{stats.data?.project_count ?? "—"}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <CalendarDays className="h-4 w-4" /> Created
          </div>
          <p className="mt-2 text-2xl font-bold">
            {stats.data ? new Date(stats.data.created_at).toLocaleDateString() : "—"}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-xl border bg-card p-6 lg:col-span-3">
          <div className="flex items-center justify-between">
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
          {members.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="mt-4 divide-y">
              {members.data?.map((m) => {
                const isSelf = m.user_id === user?.id;
                const isOwner = m.role === "owner";
                return (
                  <li key={m.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      {canManage && !isOwner ? (
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
                            <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Joined {new Date(m.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isOwner ? "default" : "secondary"}>{m.role}</Badge>
                      {canManage && !isOwner && (
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

          {canManage && availableToAdd.length > 0 && (
            <div className="mt-6 border-t pt-4">
              <p className="text-sm font-semibold">Bulk add members</p>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded border p-2">
                {availableToAdd.map((m) => {
                  const key = `add:${m.user_id}`;
                  return (
                    <label
                      key={m.user_id}
                      className="flex cursor-pointer items-center gap-2 rounded p-1 text-sm hover:bg-muted"
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
            </div>
          )}


          {canManage && (
            <div className="mt-6 flex items-end gap-2 border-t pt-4">
              <div className="flex-1">
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

        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold">Settings</h2>
            {canManage ? (
              <form onSubmit={handleSubmit((v) => save.mutate(v))} className="mt-4 space-y-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" {...register("name")} />
                  {formState.errors.name && (
                    <p className="mt-1 text-xs text-destructive">{formState.errors.name.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" {...register("slug")} />
                  {formState.errors.slug && (
                    <p className="mt-1 text-xs text-destructive">{formState.errors.slug.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" rows={3} {...register("description")} />
                </div>
                <Button type="submit" disabled={save.isPending} className="w-full">
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
              </form>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Only the team owner or organization admins can edit settings.
              </p>
            )}
          </section>

          {canManage && (
            <section className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">Transfer ownership</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Move ownership to another team member.
              </p>
              <div className="mt-4 flex items-end gap-2">
                <div className="flex-1">
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
                    <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          )}
        </div>
      </div>

      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Activity</h2>
        {activity.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
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
    </div>
  );
}
