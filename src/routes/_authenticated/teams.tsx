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
  updateTeamAvatar,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  ArrowRight,
  Building2,
  CalendarDays,
  FolderKanban,
  ImagePlus,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Users,
  UsersRound,
  X,
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
  department_id?: string | null;
};

type EnrichedTeam = TeamRow & {
  owner?: { full_name: string | null; avatar_url: string | null } | null;
  department?: { id: string; name: string } | null;
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
  const [pendingDelete, setPendingDelete] = useState<EnrichedTeam | null>(null);

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
      const deptIds = Array.from(
        new Set(rows.map((t) => t.department_id).filter((v): v is string => !!v)),
      );

      const [profilesRes, membersRes, projectsRes, deptsRes] = await Promise.all([
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
        deptIds.length
          ? supabase.from("departments").select("id, name").in("id", deptIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);

      const owners = Object.fromEntries(
        (profilesRes.data ?? []).map((p) => [p.id, p]),
      );
      const depts = Object.fromEntries(
        (deptsRes.data ?? []).map((d) => [d.id, d]),
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
          department: t.department_id ? depts[t.department_id] ?? null : null,
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
      setPendingDelete(null);
      qc.invalidateQueries({ queryKey: ["teams", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = teams.data?.rows ?? [];
  const activeFilterCount = (debounced ? 1 : 0) + (status !== "active" ? 1 : 0);

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
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:items-center">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
            Teams
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Groups collaborating in{" "}
            <span className="font-medium text-foreground">{org.name}</span>
            {teams.data?.total != null && (
              <span className="ml-1 text-muted-foreground/70">
                · {teams.data.total} total
              </span>
            )}
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => setCreateOpen(true)}
            className="shrink-0 shadow-sm"
            size="sm"
          >
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Create team</span>
            <span className="sr-only sm:hidden">Create team</span>
          </Button>
        )}
      </header>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:min-w-[240px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search teams…"
            className="h-11 pl-9 pr-9 sm:h-10"
            aria-label="Search teams"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-none sm:gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger
              className="h-11 w-full sm:h-10 sm:w-[140px]"
              aria-label="Filter by status"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortBy)}>
            <SelectTrigger
              className="h-11 w-full sm:h-10 sm:w-[170px]"
              aria-label="Sort teams"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="az">Name (A–Z)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setStatus("active");
            }}
            className="h-9 self-start text-muted-foreground"
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Grid */}
      {teams.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border bg-card p-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="mt-4 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-4/5" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-6 w-20 rounded-md" />
                <Skeleton className="h-6 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : teams.isError ? (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive"
        >
          {(teams.error as Error).message}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-8 text-center sm:p-12">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <UsersRound className="h-7 w-7" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-lg font-semibold">
            {debounced ? "No teams match your search" : "No teams yet"}
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {canCreate
              ? "Create the first team to start collaborating on projects and initiatives."
              : "Ask an admin to create a team you can join."}
          </p>
          {canCreate && (
            <Button className="mt-5" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Create team
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              canManage={isAdmin}
              onArchive={() =>
                archiveMut.mutate({ teamId: t.id, archive: !t.archived_at })
              }
              onRestore={() => restoreMut.mutate(t.id)}
              onDelete={() => setPendingDelete(t)}
            />
          ))}
        </div>
      )}

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={org.id}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete team “{pendingDelete?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the team and its memberships. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delMut.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={delMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) delMut.mutate(pendingDelete.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {delMut.isPending ? "Deleting…" : "Delete team"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const initials = team.name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const isArchived = !!team.archived_at;
  const leadInitials = (team.owner?.full_name ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-within:border-primary/50"
      aria-label={`Team ${team.name}`}
    >
      {/* Accent bar */}
      <div
        className="h-1 w-full bg-gradient-to-r from-primary/70 via-primary/40 to-transparent"
        aria-hidden="true"
      />

      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
          {team.avatar_url ? (
            <img
              src={team.avatar_url}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl border object-cover"
            />
          ) : (
            <div
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border bg-gradient-to-br from-primary/15 to-primary/5 text-sm font-semibold text-primary"
              aria-hidden="true"
            >
              {initials || "?"}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                to="/teams/$teamId"
                params={{ teamId: team.id }}
                className="truncate rounded text-base font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {team.name}
              </Link>
              {isArchived && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  Archived
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="truncate font-mono text-xs text-muted-foreground">
                /{team.slug}
              </span>
              {team.department && (
                <Badge
                  variant="secondary"
                  className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium"
                >
                  <Building2 className="h-3 w-3" aria-hidden="true" />
                  {team.department.name}
                </Badge>
              )}
            </div>

          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 text-muted-foreground"
                  aria-label={`Actions for ${team.name}`}
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

        <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
          {team.description || "No description provided."}
        </p>

        <dl className="grid grid-cols-3 gap-2 text-xs">
          <Stat
            icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Members"
            value={team.member_count}
          />
          <Stat
            icon={<FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Projects"
            value={team.project_count}
          />
          <Stat
            icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}
            label="Created"
            value={new Date(team.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          />
        </dl>

        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-4">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className="h-7 w-7 shrink-0">
              {team.owner?.avatar_url && (
                <AvatarImage src={team.owner.avatar_url} alt="" />
              )}
              <AvatarFallback className="text-[10px]">
                {leadInitials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 leading-tight">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Lead
              </p>
              <p className="truncate text-xs font-medium">
                {team.owner?.full_name ?? "Unassigned"}
              </p>
            </div>
          </div>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="shrink-0 gap-1"
          >
            <Link to="/teams/$teamId" params={{ teamId: team.id }}>
              Open
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 px-2 py-1.5">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-foreground">
        {value}
      </dd>
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
  const setAvatarFn = useServerFn(updateTeamAvatar);

  const [leadId, setLeadId] = useState<string>("");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [initialMembers, setInitialMembers] = useState<Record<string, boolean>>({});
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  const departments = useQuery({
    enabled: open,
    queryKey: ["departments-for-new-team", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });


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
      setDepartmentId("");
      setInitialMembers({});
      setAvatarFile(null);
    }
  }, [open, form]);

  const create = useMutation({
    mutationFn: async (v: TeamValues) => {
      const team = await createFn({
        data: {
          organizationId,
          ...v,
          departmentId: departmentId || null,
        },
      });
      const memberIds = Object.keys(initialMembers).filter((k) => initialMembers[k]);
      if (memberIds.length) {
        await bulkAddFn({ data: { teamId: team.id, userIds: memberIds } });
      }
      if (leadId) {
        await setLeadFn({ data: { teamId: team.id, leadId } });
      }
      if (avatarFile) {
        try {
          const ext = avatarFile.name.split(".").pop()?.toLowerCase() || "png";
          const path = `${organizationId}/${team.id}/avatar-${Date.now()}.${ext}`;
          const up = await supabase.storage
            .from("team-avatars")
            .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
          if (up.error) throw up.error;
          const { data: pub } = supabase.storage.from("team-avatars").getPublicUrl(path);
          if (pub?.publicUrl) {
            await setAvatarFn({ data: { teamId: team.id, avatarUrl: pub.publicUrl } });
          }
        } catch (e) {
          // Don't fail creation if avatar upload fails
          toast.warning(
            `Team created, but avatar upload failed: ${(e as Error).message}`,
          );
        }
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


  const selectedCount = Object.values(initialMembers).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
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
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              placeholder="Platform Engineering"
              autoComplete="off"
              {...form.register("name")}
              aria-invalid={!!form.formState.errors.name}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive" role="alert">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-slug">Slug</Label>
            <Input
              id="team-slug"
              placeholder="platform-eng"
              autoComplete="off"
              {...form.register("slug")}
              aria-invalid={!!form.formState.errors.slug}
            />
            {form.formState.errors.slug && (
              <p className="text-xs text-destructive" role="alert">
                {form.formState.errors.slug.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-description">Description</Label>
            <Textarea
              id="team-description"
              rows={2}
              placeholder="What does this team focus on?"
              {...form.register("description")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-lead">Team lead</Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger id="team-lead">
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
            <p className="text-xs text-muted-foreground">
              If empty, you become the lead. You can transfer this later.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Initial members</Label>
              {selectedCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {selectedCount} selected
                </span>
              )}
            </div>
            <div
              className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border p-1"
              role="group"
              aria-label="Initial members"
            >
              {(orgMembers.data ?? []).length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">
                  Loading members…
                </p>
              ) : (
                (orgMembers.data ?? []).map((m) => {
                  const checked = !!initialMembers[m.user_id];
                  return (
                    <label
                      key={m.user_id}
                      className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          setInitialMembers((s) => ({
                            ...s,
                            [m.user_id]: !!v,
                          }))
                        }
                      />
                      <span className="flex-1 truncate">{m.full_name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {m.role}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
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
