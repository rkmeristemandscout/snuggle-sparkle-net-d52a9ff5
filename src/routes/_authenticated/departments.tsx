import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listDepartments,
  archiveDepartment,
  restoreDepartment,
  setDepartmentManager,
  setDepartmentParent,
  getDepartmentMemberCounts,
} from "@/lib/departments.functions";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useSession } from "@/hooks/use-session";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building2,
  CheckCircle2,
  PauseCircle,
  Users,
  Plus,
  Search,
  MoreHorizontal,
  Eye,
  Pencil,
  Archive,
  ArchiveRestore,
  Trash2,
  RotateCcw,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/departments")({
  component: DepartmentsPage,
});

type DeptRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  manager_id: string | null;
  parent_id: string | null;
  code: string | null;
  status: string | null;
  headcount_limit: number | null;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

type StatusFilter = "active" | "archived" | "deleted";
type SortField = "name" | "created_at";

// ---------------- Modal schema ----------------
const modalSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(60),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits, and dashes only"),
  code: z
    .string()
    .trim()
    .max(20)
    .regex(/^[A-Za-z0-9_-]*$/, "letters, digits, dashes, underscores")
    .optional()
    .or(z.literal("")),
  description: z.string().trim().max(280).optional().or(z.literal("")),
  managerId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "on_hold", "planning"]).default("active"),
});
type ModalValues = z.infer<typeof modalSchema>;

function slugify(v: string) {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

function DepartmentsPage() {
  useSession();
  const { currentMembership } = useCurrentOrg();
  const { can } = usePermissions();
  const org = currentMembership?.organization;
  const canManage = can(["department.create", "department.update", "department.delete"]);
  const isAdmin =
    currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const qc = useQueryClient();

  const [status, setStatus] = useState<StatusFilter>("active");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DeptRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const listFn = useServerFn(listDepartments);
  const countsFn = useServerFn(getDepartmentMemberCounts);
  const archiveFn = useServerFn(archiveDepartment);
  const restoreFn = useServerFn(restoreDepartment);
  const delFn = useServerFn(deleteDepartment);

  const departments = useQuery({
    enabled: !!org,
    queryKey: ["departments-v2", org?.id, status, debounced, sortField, sortDir],
    queryFn: async () => {
      const res = await listFn({
        data: {
          organizationId: org!.id,
          status,
          search: debounced || undefined,
          sort: sortField,
          dir: sortDir,
          limit: 200,
        },
      });
      const rows = res.rows as DeptRow[];
      const managerIds = Array.from(
        new Set(rows.map((r) => r.manager_id).filter((x): x is string => !!x)),
      );
      let managers: Record<string, { full_name: string | null }> = {};
      if (managerIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", managerIds);
        managers = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      }
      const parentIds = Array.from(
        new Set(rows.map((r) => r.parent_id).filter((x): x is string => !!x)),
      );
      let parents: Record<string, { name: string }> = {};
      if (parentIds.length) {
        const { data: par } = await supabase
          .from("departments")
          .select("id, name")
          .in("id", parentIds);
        parents = Object.fromEntries((par ?? []).map((p) => [p.id, p]));
      }
      return { rows, total: res.total, managers, parents };
    },
  });

  const counts = useQuery({
    enabled: !!org,
    queryKey: ["dept-member-counts", org?.id],
    queryFn: () => countsFn({ data: { organizationId: org!.id } }),
  });

  // Realtime refresh on department + membership changes
  useEffect(() => {
    if (!org) return;
    const ch = supabase
      .channel(`departments-page-${org.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "departments",
          filter: `organization_id=eq.${org.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["departments-v2", org.id] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "organization_members",
          filter: `organization_id=eq.${org.id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["dept-member-counts", org.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [org, qc]);

  const rows = departments.data?.rows ?? [];
  const managers = departments.data?.managers ?? {};
  const parents = departments.data?.parents ?? {};
  const byDept = counts.data?.byDept ?? {};

  // Stats (across the full active/archived set — independent of filter)
  const statsQuery = useQuery({
    enabled: !!org,
    queryKey: ["dept-stats", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, archived_at, deleted_at")
        .eq("organization_id", org!.id);
      if (error) throw error;
      const list = data ?? [];
      const notDeleted = list.filter((d) => !d.deleted_at);
      return {
        total: notDeleted.length,
        active: notDeleted.filter((d) => !d.archived_at).length,
        inactive: notDeleted.filter((d) => !!d.archived_at).length,
      };
    },
  });

  const totalEmployees = counts.data?.totalAssigned ?? 0;

  const archiveMut = useMutation({
    mutationFn: async (v: { departmentId: string; archive: boolean }) =>
      archiveFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(v.archive ? "Department archived" : "Department restored to active");
      qc.invalidateQueries({ queryKey: ["departments-v2", org?.id] });
      qc.invalidateQueries({ queryKey: ["dept-stats", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMut = useMutation({
    mutationFn: async (departmentId: string) => restoreFn({ data: { departmentId } }),
    onSuccess: () => {
      toast.success("Department restored");
      qc.invalidateQueries({ queryKey: ["departments-v2", org?.id] });
      qc.invalidateQueries({ queryKey: ["dept-stats", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (departmentId: string) => delFn({ data: { departmentId } }),
    onSuccess: () => {
      toast.success("Department deleted");
      qc.invalidateQueries({ queryKey: ["departments-v2", org?.id] });
      qc.invalidateQueries({ queryKey: ["dept-stats", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (d: DeptRow) => {
    setEditing(d);
    setModalOpen(true);
  };

  if (!org) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Select an organization to see its departments.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ============= Header ============= */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organize {org.name} into departments with managers, budgets, and hierarchies.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate} className="sm:min-w-[180px]">
            <Plus className="mr-1.5 h-4 w-4" /> Add department
          </Button>
        )}
      </header>

      {/* ============= Stats ============= */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Building2 className="h-4 w-4" />}
          label="Total departments"
          value={statsQuery.data?.total ?? "—"}
          loading={statsQuery.isLoading}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Active"
          value={statsQuery.data?.active ?? "—"}
          loading={statsQuery.isLoading}
        />
        <StatCard
          icon={<PauseCircle className="h-4 w-4 text-amber-500" />}
          label="Inactive (archived)"
          value={statsQuery.data?.inactive ?? "—"}
          loading={statsQuery.isLoading}
        />
        <StatCard
          icon={<Users className="h-4 w-4 text-primary" />}
          label="Total employees"
          value={counts.isLoading ? "—" : totalEmployees}
          loading={counts.isLoading}
        />
      </div>

      {/* ============= Toolbar ============= */}
      <section className="rounded-xl border bg-card">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="pl-8"
              aria-label="Search departments"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={`${sortField}:${sortDir}`}
              onValueChange={(v) => {
                const [f, d] = v.split(":") as [SortField, "asc" | "desc"];
                setSortField(f);
                setSortDir(d);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name:asc">Name A → Z</SelectItem>
                <SelectItem value="name:desc">Name Z → A</SelectItem>
                <SelectItem value="created_at:desc">Newest first</SelectItem>
                <SelectItem value="created_at:asc">Oldest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ============= Table / list ============= */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <Th>Department</Th>
                <Th>Code</Th>
                <Th>Manager</Th>
                <Th>Employees</Th>
                <Th>Parent</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {departments.isLoading && (
                <>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td className="p-3" colSpan={8}>
                        <Skeleton className="h-6 w-full" />
                      </td>
                    </tr>
                  ))}
                </>
              )}
              {!departments.isLoading &&
                rows.map((d) => {
                  const emp = byDept[d.id] ?? 0;
                  const parentName = d.parent_id
                    ? parents[d.parent_id]?.name ?? "—"
                    : "—";
                  const managerName = d.manager_id
                    ? managers[d.manager_id]?.full_name ?? "Unnamed"
                    : "Unassigned";
                  return (
                    <tr key={d.id} className="hover:bg-muted/40">
                      <td className="p-3">
                        <Link
                          to="/departments/$departmentId"
                          params={{ departmentId: d.id }}
                          className="font-medium hover:underline"
                        >
                          {d.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">/{d.slug}</p>
                      </td>
                      <td className="p-3 font-mono text-xs">
                        {d.code || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-3">
                        <span className={d.manager_id ? "" : "text-muted-foreground"}>
                          {managerName}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{emp}</span>
                          {d.headcount_limit != null && (
                            <span className="text-xs text-muted-foreground">
                              / {d.headcount_limit}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{parentName}</td>
                      <td className="p-3">
                        <StatusBadge dept={d} />
                      </td>
                      <td className="p-3 whitespace-nowrap text-muted-foreground">
                        {new Date(d.created_at).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-right">
                        <RowActions
                          dept={d}
                          employeeCount={emp}
                          canManage={canManage}
                          isAdmin={isAdmin}
                          onView={() => {}}
                          onEdit={() => openEdit(d)}
                          onArchive={() =>
                            archiveMut.mutate({
                              departmentId: d.id,
                              archive: !d.archived_at,
                            })
                          }
                          onDelete={() => del.mutate(d.id)}
                          onRestore={() => restoreMut.mutate(d.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              {!departments.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-10 text-center text-sm text-muted-foreground">
                    <Building2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    No departments match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile list */}
        <ul className="divide-y md:hidden">
          {departments.isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="p-3">
                <Skeleton className="h-16 w-full" />
              </li>
            ))}
          {!departments.isLoading &&
            rows.map((d) => {
              const emp = byDept[d.id] ?? 0;
              return (
                <li key={d.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/departments/$departmentId"
                        params={{ departmentId: d.id }}
                        className="block truncate font-medium hover:underline"
                      >
                        {d.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {d.code ? `${d.code} · ` : ""}
                        {emp} employees
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge dept={d} />
                      <RowActions
                        dept={d}
                        employeeCount={emp}
                        canManage={canManage}
                        isAdmin={isAdmin}
                        onView={() => {}}
                        onEdit={() => openEdit(d)}
                        onArchive={() =>
                          archiveMut.mutate({
                            departmentId: d.id,
                            archive: !d.archived_at,
                          })
                        }
                        onDelete={() => del.mutate(d.id)}
                        onRestore={() => restoreMut.mutate(d.id)}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          {!departments.isLoading && rows.length === 0 && (
            <li className="p-8 text-center text-sm text-muted-foreground">
              No departments match your filters.
            </li>
          )}
        </ul>
      </section>

      {/* ============= Modal ============= */}
      {modalOpen && (
        <DepartmentModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          organizationId={org.id}
          allDepartments={rows}
          editing={editing}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["departments-v2", org.id] });
            qc.invalidateQueries({ queryKey: ["dept-stats", org.id] });
          }}
        />
      )}
    </div>
  );
}

// ============= Small components =============
function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={
        "px-3 py-2.5 text-left font-medium tracking-wide " + (className ?? "")
      }
    >
      {children}
    </th>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold">
        {loading ? <Skeleton className="h-7 w-16" /> : value}
      </p>
    </div>
  );
}

function StatusBadge({ dept }: { dept: DeptRow }) {
  if (dept.deleted_at)
    return <Badge variant="destructive">Deleted</Badge>;
  if (dept.archived_at)
    return (
      <Badge variant="outline" className="border-amber-500/50 text-amber-600">
        Inactive
      </Badge>
    );
  return (
    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600">
      Active
    </Badge>
  );
}

function RowActions({
  dept,
  employeeCount,
  canManage,
  isAdmin,
  onView,
  onEdit,
  onArchive,
  onDelete,
  onRestore,
}: {
  dept: DeptRow;
  employeeCount: number;
  canManage: boolean;
  isAdmin: boolean;
  onView: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Row actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              to="/departments/$departmentId"
              params={{ departmentId: dept.id }}
              onClick={onView}
            >
              <Eye className="mr-2 h-4 w-4" /> View
            </Link>
          </DropdownMenuItem>
          {canManage && !dept.deleted_at && (
            <>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive}>
                {dept.archived_at ? (
                  <>
                    <ArchiveRestore className="mr-2 h-4 w-4" /> Unarchive
                  </>
                ) : (
                  <>
                    <Archive className="mr-2 h-4 w-4" /> Archive
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            </>
          )}
          {dept.deleted_at && isAdmin && (
            <DropdownMenuItem onClick={onRestore}>
              <RotateCcw className="mr-2 h-4 w-4" /> Restore
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {dept.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {employeeCount > 0 ? (
                <>
                  This department still has{" "}
                  <strong>{employeeCount} employee(s)</strong>. Reassign or
                  transfer them first — delete is blocked until it's empty.
                </>
              ) : (
                <>
                  This will soft-delete the department. You can restore it later
                  from the Deleted filter.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={employeeCount > 0}
              onClick={() => {
                setConfirmDelete(false);
                onDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============= Add / Edit Modal =============
function DepartmentModal({
  open,
  onOpenChange,
  organizationId,
  allDepartments,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string;
  allDepartments: DeptRow[];
  editing: DeptRow | null;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createDepartment);
  const updateFn = useServerFn(updateDepartment);
  const setMgrFn = useServerFn(setDepartmentManager);
  const setParentFn = useServerFn(setDepartmentParent);

  const form = useForm<ModalValues>({
    resolver: zodResolver(modalSchema),
    defaultValues: {
      name: editing?.name ?? "",
      slug: editing?.slug ?? "",
      code: editing?.code ?? "",
      description: editing?.description ?? "",
      managerId: editing?.manager_id ?? null,
      parentId: editing?.parent_id ?? null,
      status:
        (editing?.status as "active" | "on_hold" | "planning" | undefined) ??
        "active",
    },
  });
  const { register, handleSubmit, formState, setValue, watch } = form;

  const nameValue = watch("name");
  useEffect(() => {
    if (!editing && nameValue && !form.getFieldState("slug").isDirty) {
      setValue("slug", slugify(nameValue), { shouldValidate: true });
    }
  }, [editing, nameValue, setValue, form]);

  // org members for manager picker
  const members = useQuery({
    enabled: open,
    queryKey: ["dept-modal-members", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", organizationId);
      if (error) throw error;
      const ids = (data ?? []).map((m) => m.user_id);
      if (!ids.length) return [] as { user_id: string; full_name: string | null }[];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      const map = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
      return ids.map((id) => ({ user_id: id, full_name: map[id] ?? null }));
    },
  });

  const save = useMutation({
    mutationFn: async (v: ModalValues) => {
      if (editing) {
        await updateFn({
          data: {
            departmentId: editing.id,
            name: v.name,
            slug: v.slug,
            code: v.code || null,
            description: v.description || "",
            status: v.status,
          },
        });
        if ((v.managerId ?? null) !== (editing.manager_id ?? null)) {
          await setMgrFn({
            data: { departmentId: editing.id, managerId: v.managerId ?? null },
          });
        }
        if ((v.parentId ?? null) !== (editing.parent_id ?? null)) {
          await setParentFn({
            data: { departmentId: editing.id, parentId: v.parentId ?? null },
          });
        }
        return { id: editing.id };
      }
      const created = await createFn({
        data: {
          organizationId,
          name: v.name,
          slug: v.slug,
          description: v.description || "",
        },
      });
      // Post-create: apply code/status/manager/parent via update RPCs.
      const patch: Record<string, unknown> = {};
      if (v.code) patch.code = v.code;
      if (v.status && v.status !== "active") patch.status = v.status;
      if (Object.keys(patch).length) {
        await updateFn({ data: { departmentId: created.id, ...patch } });
      }
      if (v.managerId) {
        await setMgrFn({
          data: { departmentId: created.id, managerId: v.managerId },
        });
      }
      if (v.parentId) {
        await setParentFn({
          data: { departmentId: created.id, parentId: v.parentId },
        });
      }
      return created;
    },
    onSuccess: () => {
      toast.success(editing ? "Department updated" : "Department created");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // parent options exclude self + descendants (basic guard — server also validates cycles)
  const parentOptions = useMemo(
    () =>
      allDepartments.filter(
        (d) => !d.deleted_at && !d.archived_at && d.id !== editing?.id,
      ),
    [allDepartments, editing?.id],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${editing.name}` : "Add department"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Update department details, manager, and hierarchy."
              : "Create a new department in your organization."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((v) => save.mutate(v))}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dm-name">Name *</Label>
              <Input id="dm-name" placeholder="Engineering" {...register("name")} />
              {formState.errors.name && (
                <p className="text-xs text-destructive">
                  {formState.errors.name.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dm-code">Code</Label>
              <Input
                id="dm-code"
                placeholder="ENG"
                className="font-mono"
                {...register("code")}
              />
              {formState.errors.code && (
                <p className="text-xs text-destructive">
                  {formState.errors.code.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dm-slug">Slug *</Label>
            <Input id="dm-slug" placeholder="engineering" {...register("slug")} />
            {formState.errors.slug && (
              <p className="text-xs text-destructive">
                {formState.errors.slug.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dm-desc">Description</Label>
            <Textarea
              id="dm-desc"
              rows={2}
              placeholder="What does this department own?"
              {...register("description")}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dm-manager">Manager</Label>
              <Select
                value={watch("managerId") ?? "__none"}
                onValueChange={(v) =>
                  setValue("managerId", v === "__none" ? null : v, {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="dm-manager">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
                  {(members.data ?? []).map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name ?? m.user_id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dm-parent">Parent department</Label>
              <Select
                value={watch("parentId") ?? "__none"}
                onValueChange={(v) =>
                  setValue("parentId", v === "__none" ? null : v, {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="dm-parent">
                  <SelectValue placeholder="Top-level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Top-level (no parent)</SelectItem>
                  {parentOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dm-status">Status</Label>
            <Select
              value={watch("status")}
              onValueChange={(v) =>
                setValue("status", v as "active" | "on_hold" | "planning", {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger id="dm-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="planning">Planning</SelectItem>
                <SelectItem value="on_hold">On hold</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              To mark as "Inactive", use Archive from the row actions.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending
                ? "Saving…"
                : editing
                  ? "Save changes"
                  : "Create department"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
