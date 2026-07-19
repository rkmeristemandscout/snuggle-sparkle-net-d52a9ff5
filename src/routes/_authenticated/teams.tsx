import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { teamSchema, type TeamValues } from "@/lib/auth-schemas";
import {
  createTeam,
  listTeams,
  archiveTeam,
  restoreTeam,
  deleteTeam,
  setTeamLead,
  bulkAddTeamMembers,
} from "@/lib/teams.functions";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  FolderKanban,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Users,
  UsersRound,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/teams")({
  component: TeamsPage,
});

type TeamRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  avatar_url?: string | null;
};

type EnrichedTeam = TeamRow & {
  owner?: { full_name: string | null; avatar_url: string | null } | null;
  member_count: number;
  project_count: number;
};

type StatusFilter = "active" | "archived";
type SortBy = "newest" | "oldest" | "az";

function TeamsPage() {
  const { currentMembership } = useCurrentOrg();
  const { can } = usePermissions();
  const org = currentMembership?.organization;
  const canCreate = can("team.create");
  const isAdmin =
    currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<SortBy>("newest");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const listFn = useServerFn(listTeams);
  const archiveFn = useServerFn(archiveTeam);
  const restoreFn = useServerFn(restoreTeam);
  const delFn = useServerFn(deleteTeam);

  const sortConfig = useMemo(() => {
    if (sort === "az") return { sort: "name" as const, dir: "asc" as const };
    if (sort === "oldest")
      return { sort: "created_at" as const, dir: "asc" as const };
    return { sort: "created_at" as const, dir: "desc" as const };
  }, [sort]);

  const teams = useQuery({
    enabled: !!org,
    queryKey: ["teams", org?.id, status, debounced, sort],
    queryFn: async (): Promise<{ rows: EnrichedTeam[]; total: number | null }> => {
      const res = await listFn({
        data: {
          organizationId: org!.id,
          status,
          search: debounced || undefined,
          sort: sortConfig.sort,
          dir: sortConfig.dir,
          limit: 60,
        },
      });
      const rows = res.rows as TeamRow[];
      const ownerIds = Array.from(new Set(rows.map((t) => t.owner_id)));
      const teamIds = rows.map((t) => t.id);

      const [profilesRes, membersRes, projectsRes] = await Promise.all([
        ownerIds.length
          ? supabase
              .from("profiles")
              .select("id, full_name, avatar_url")
              .in("id", ownerIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string | null; avatar_url: string | null }[] }),
        teamIds.length
          ? supabase.from("team_members").select("team_id").in("team_id", teamIds)
          : Promise.resolve({ data: [] as { team_id: string }[] }),
        teamIds.length
          ? supabase
              .from("projects")
              .select("team_id")
              .in("team_id", teamIds)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] as { team_id: string | null }[] }),
      ]);

      const owners = Object.fromEntries(
        (profilesRes.data ?? []).map((p) => [p.id, p]),
      );
      const memberCounts: Record<string, number> = {};
      (membersRes.data ?? []).forEach((m) => {
        memberCounts[m.team_id] = (memberCounts[m.team_id] ?? 0) + 1;
      });
      const projectCounts: Record<string, number> = {};
      (projectsRes.data ?? []).forEach((p) => {
        if (p.team_id) projectCounts[p.team_id] = (projectCounts[p.team_id] ?? 0) + 1;
      });

      return {
        rows: rows.map((t) => ({
          ...t,
          owner: owners[t.owner_id] ?? null,
          member_count: memberCounts[t.id] ?? 0,
          project_count: projectCounts[t.id] ?? 0,
        })),
        total: res.total,
      };
    },
  });

  // Realtime
  useEffect(() => {
    if (!org) return;
    const ch = supabase
      .channel(`teams-${org.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "teams", filter: `organization_id=eq.${org.id}` },
        () => qc.invalidateQueries({ queryKey: ["teams", org.id] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_members" },
        () => qc.invalidateQueries({ queryKey: ["teams", org.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [org, qc]);

  const archiveMut = useMutation({
    mutationFn: async (v: { teamId: string; archive: boolean }) => archiveFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(v.archive ? "Team archived" : "Team restored");
      qc.invalidateQueries({ queryKey: ["teams", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMut = useMutation({
    mutationFn: async (teamId: string) => restoreFn({ data: { teamId } }),
    onSuccess: () => {
      toast.success("Team restored");
      qc.invalidateQueries({ queryKey: ["teams", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (teamId: string) => delFn({ data: { teamId } }),
    onSuccess: () => {
      toast.success("Team deleted");
      qc.invalidateQueries({ queryKey: ["teams", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = teams.data?.rows ?? [];

  if (!org) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Select an organization to see its teams.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Groups of people collaborating in {org.name}.
            {teams.data?.total != null && ` · ${teams.data.total} total`}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Create team
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search teams…"
            className="pl-8"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortBy)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="az">Name (A–Z)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {teams.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="mt-4 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-4/5" />
            </div>
          ))}
        </div>
      ) : teams.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-card p-6 text-sm text-destructive">
          {(teams.error as Error).message}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center">
          <UsersRound className="mx-auto h-10 w-10 text-muted-foreground" />
          <h3 className="mt-3 text-lg font-semibold">
            {debounced ? "No teams match your search" : "No teams yet"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {canCreate
              ? "Create the first team to start collaborating."
              : "Ask an admin to create a team."}
          </p>
          {canCreate && (
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Create team
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              canManage={isAdmin}
              onArchive={() =>
                archiveMut.mutate({ teamId: t.id, archive: !t.archived_at })
              }
              onRestore={() => restoreMut.mutate(t.id)}
              onDelete={() => {
                if (confirm(`Delete team "${t.name}"? This can't be undone.`))
                  delMut.mutate(t.id);
              }}
            />
          ))}
        </div>
      )}

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={org.id}
      />
    </div>
  );
}

function TeamCard({
  team,
  canManage,
  onArchive,
  onRestore,
  onDelete,
}: {
  team: EnrichedTeam;
  canManage: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const initials = team.name.slice(0, 2).toUpperCase();
  const isArchived = !!team.archived_at;
  return (
    <div className="group relative flex flex-col rounded-xl border bg-card p-5 transition-colors hover:border-primary/50">
      <div className="flex items-start gap-3">
        {team.avatar_url ? (
          <img
            src={team.avatar_url}
            alt=""
            className="h-12 w-12 rounded-lg border object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border bg-muted text-sm font-semibold text-muted-foreground">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              to="/teams/$teamId"
              params={{ teamId: team.id }}
              className="truncate text-base font-semibold hover:underline"
            >
              {team.name}
            </Link>
            {isArchived && (
              <Badge variant="outline" className="text-xs">
                Archived
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">/{team.slug}</p>
        </div>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 opacity-70 group-hover:opacity-100"
                aria-label="Team actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isArchived ? (
                <DropdownMenuItem onClick={onRestore}>
                  <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onArchive}>
                  <Archive className="mr-2 h-4 w-4" /> Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
        {team.description || "No description provided."}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1">
          <Users className="h-3.5 w-3.5" /> {team.member_count} members
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1">
          <FolderKanban className="h-3.5 w-3.5" /> {team.project_count} projects
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1">
          <CalendarDays className="h-3.5 w-3.5" />
          {new Date(team.created_at).toLocaleDateString()}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Lead:</span>
          <span className="font-medium">
            {team.owner?.full_name ?? "Unassigned"}
          </span>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/teams/$teamId" params={{ teamId: team.id }}>
            Open
          </Link>
        </Button>
      </div>
    </div>
  );
}

function CreateTeamDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createTeam);
  const setLeadFn = useServerFn(setTeamLead);
  const bulkAddFn = useServerFn(bulkAddTeamMembers);

  const [leadId, setLeadId] = useState<string>("");
  const [initialMembers, setInitialMembers] = useState<Record<string, boolean>>({});

  const orgMembers = useQuery({
    enabled: open,
    queryKey: ["org-members-for-new-team", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", organizationId);
      if (error) throw error;
      const ids = (data ?? []).map((m) => m.user_id);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, full_name").in("id", ids)
        : { data: [] as { id: string; full_name: string | null }[] };
      const profMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      return (data ?? []).map((m) => ({
        user_id: m.user_id,
        role: m.role,
        full_name: profMap[m.user_id]?.full_name ?? m.user_id.slice(0, 8),
      }));
    },
  });

  const form = useForm<TeamValues>({
    resolver: zodResolver(teamSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });
  const nameValue = form.watch("name");
  useEffect(() => {
    if (!form.getFieldState("slug").isDirty && nameValue) {
      const slug = nameValue
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      form.setValue("slug", slug, { shouldValidate: true });
    }
  }, [nameValue, form]);

  useEffect(() => {
    if (!open) {
      form.reset({ name: "", slug: "", description: "" });
      setLeadId("");
      setInitialMembers({});
    }
  }, [open, form]);

  const create = useMutation({
    mutationFn: async (v: TeamValues) => {
      const team = await createFn({ data: { organizationId, ...v } });
      const memberIds = Object.keys(initialMembers).filter((k) => initialMembers[k]);
      if (memberIds.length) {
        await bulkAddFn({ data: { teamId: team.id, userIds: memberIds } });
      }
      if (leadId) {
        await setLeadFn({ data: { teamId: team.id, leadId } });
      }
      return team;
    },
    onSuccess: () => {
      toast.success("Team created");
      qc.invalidateQueries({ queryKey: ["teams", organizationId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create team</DialogTitle>
          <DialogDescription>
            Group people together to collaborate on projects.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="Platform Engineering"
              {...form.register("name")}
            />
            {form.formState.errors.name && (
              <p className="mt-1 text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input id="slug" placeholder="platform-eng" {...form.register("slug")} />
            {form.formState.errors.slug && (
              <p className="mt-1 text-xs text-destructive">
                {form.formState.errors.slug.message}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={2}
              placeholder="What does this team focus on?"
              {...form.register("description")}
            />
          </div>
          <div>
            <Label>Team lead</Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger>
                <SelectValue placeholder="You (default)" />
              </SelectTrigger>
              <SelectContent>
                {(orgMembers.data ?? []).map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name} · {m.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              If empty, you become the lead. You can transfer this later.
            </p>
          </div>
          <div>
            <Label>Initial members</Label>
            <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded border p-2">
              {(orgMembers.data ?? []).length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">
                  Loading members…
                </p>
              ) : (
                (orgMembers.data ?? []).map((m) => (
                  <label
                    key={m.user_id}
                    className="flex cursor-pointer items-center gap-2 rounded p-1 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={!!initialMembers[m.user_id]}
                      onCheckedChange={(v) =>
                        setInitialMembers((s) => ({ ...s, [m.user_id]: !!v }))
                      }
                    />
                    <span className="flex-1">{m.full_name}</span>
                    <span className="text-xs text-muted-foreground">{m.role}</span>
                  </label>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
