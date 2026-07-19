import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { departmentSchema, type DepartmentValues } from "@/lib/auth-schemas";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listDepartments,
  archiveDepartment,
  restoreDepartment,
  setDepartmentManager,
} from "@/lib/departments.functions";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useSession } from "@/hooks/use-session";
import { usePermissions } from "@/hooks/use-permissions";
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
import { Pencil, Trash2, X, Check, Archive, ArchiveRestore, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/departments")({
  component: DepartmentsPage,
});

type DeptRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  manager_id: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  manager?: { full_name: string | null } | null;
};

type StatusFilter = "active" | "archived" | "deleted";

function DepartmentsPage() {
  useSession();
  const { currentMembership } = useCurrentOrg();
  const { can } = usePermissions();
  const org = currentMembership?.organization;
  const canManage = can(["department.create", "department.update", "department.delete"]);
  const isAdmin = currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [managingId, setManagingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const listFn = useServerFn(listDepartments);
  const createFn = useServerFn(createDepartment);
  const delFn = useServerFn(deleteDepartment);
  const archiveFn = useServerFn(archiveDepartment);
  const restoreFn = useServerFn(restoreDepartment);
  const setMgrFn = useServerFn(setDepartmentManager);

  const departments = useQuery({
    enabled: !!org,
    queryKey: ["departments", org?.id, status, debounced],
    queryFn: async () => {
      const res = await listFn({
        data: {
          organizationId: org!.id,
          status,
          search: debounced || undefined,
          sort: "name",
          dir: "asc",
          limit: 100,
        },
      });
      const rows = res.rows as DeptRow[];
      const ids = Array.from(new Set(rows.map((d) => d.manager_id).filter((x): x is string => !!x)));
      let managers: Record<string, { full_name: string | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        managers = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      }
      return {
        rows: rows.map((d) => ({
          ...d,
          manager: d.manager_id ? managers[d.manager_id] ?? null : null,
        })),
        total: res.total,
      };
    },
  });

  // Org member list for manager assignment
  const orgMembers = useQuery({
    enabled: !!org && !!managingId,
    queryKey: ["org-members-simple", org?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", org!.id);
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

  useEffect(() => {
    if (!org) return;
    const ch = supabase
      .channel(`departments-${org.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "departments",
          filter: `organization_id=eq.${org.id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["departments", org.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [org, qc]);

  const { register, handleSubmit, reset, formState } = useForm<DepartmentValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  const create = useMutation({
    mutationFn: async (v: DepartmentValues) => {
      if (!org) throw new Error("Missing organization");
      return createFn({ data: { organizationId: org.id, ...v } });
    },
    onSuccess: () => {
      toast.success("Department created");
      reset();
      qc.invalidateQueries({ queryKey: ["departments", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (departmentId: string) => delFn({ data: { departmentId } }),
    onSuccess: () => {
      toast.success("Department deleted");
      qc.invalidateQueries({ queryKey: ["departments", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMut = useMutation({
    mutationFn: async (v: { departmentId: string; archive: boolean }) => archiveFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(v.archive ? "Department archived" : "Department unarchived");
      qc.invalidateQueries({ queryKey: ["departments", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreMut = useMutation({
    mutationFn: async (departmentId: string) => restoreFn({ data: { departmentId } }),
    onSuccess: () => {
      toast.success("Department restored");
      qc.invalidateQueries({ queryKey: ["departments", org?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const managerMut = useMutation({
    mutationFn: async (v: { departmentId: string; managerId: string | null }) =>
      setMgrFn({ data: v }),
    onSuccess: () => {
      toast.success("Manager updated");
      qc.invalidateQueries({ queryKey: ["departments", org?.id] });
      setManagingId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo(() => departments.data?.rows ?? [], [departments.data]);

  if (!org) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Select an organization to see its departments.
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="rounded-xl border bg-card p-6 md:col-span-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Departments in {org.name}</h2>
          {departments.data?.total != null && (
            <Badge variant="secondary">{departments.data.total} total</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          New organizations start with HR, Sales, Marketing, Engineering, and Finance.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search departments…"
              className="pl-8"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="deleted">Deleted</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {departments.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
        ) : departments.isError ? (
          <p className="mt-4 text-sm text-destructive">
            {(departments.error as Error).message}
          </p>
        ) : rows.length > 0 ? (
          <ul className="mt-4 divide-y">
            {rows.map((d) =>
              editingId === d.id ? (
                <EditRow
                  key={d.id}
                  dept={d}
                  onDone={() => {
                    setEditingId(null);
                    qc.invalidateQueries({ queryKey: ["departments", org.id] });
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <li key={d.id} className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {d.name}
                        {d.archived_at && !d.deleted_at && (
                          <Badge variant="outline" className="ml-2">Archived</Badge>
                        )}
                        {d.deleted_at && (
                          <Badge variant="destructive" className="ml-2">Deleted</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        /{d.slug} · manager {d.manager?.full_name ?? "unassigned"}
                      </p>
                      {d.description && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-1">
                          {d.description}
                        </p>
                      )}
                    </div>
                    {canManage && !d.deleted_at && (
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Manager"
                          onClick={() => setManagingId(managingId === d.id ? null : d.id)}
                        >
                          <span className="text-xs">MGR</span>
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={d.archived_at ? "Unarchive" : "Archive"}
                          onClick={() =>
                            archiveMut.mutate({ departmentId: d.id, archive: !d.archived_at })
                          }
                        >
                          {d.archived_at ? (
                            <ArchiveRestore className="h-4 w-4" />
                          ) : (
                            <Archive className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => setEditingId(d.id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" aria-label="Delete">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {d.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The department will be soft-deleted and can be restored from the Deleted filter.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del.mutate(d.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                    {d.deleted_at && isAdmin && (
                      <Button size="sm" variant="outline" onClick={() => restoreMut.mutate(d.id)}>
                        Restore
                      </Button>
                    )}
                  </div>
                  {managingId === d.id && canManage && !d.deleted_at && (
                    <div className="mt-3 flex items-center gap-2 rounded-md border p-2">
                      <Select
                        value={d.manager_id ?? "__none"}
                        onValueChange={(v) =>
                          managerMut.mutate({
                            departmentId: d.id,
                            managerId: v === "__none" ? null : v,
                          })
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Assign manager…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">No manager</SelectItem>
                          {(orgMembers.data ?? []).map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id}>
                              {m.full_name ?? m.user_id.slice(0, 8)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No departments match.</p>
        )}
      </section>

      {canManage && (
        <section className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold">New department</h2>
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="mt-4 space-y-4">
            <div>
              <Label htmlFor="dept-name">Name</Label>
              <Input id="dept-name" {...register("name")} />
              {formState.errors.name && (
                <p className="mt-1 text-xs text-destructive">{formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="dept-slug">Slug</Label>
              <Input id="dept-slug" placeholder="operations" {...register("slug")} />
              {formState.errors.slug && (
                <p className="mt-1 text-xs text-destructive">{formState.errors.slug.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="dept-desc">Description</Label>
              <Textarea id="dept-desc" rows={3} {...register("description")} />
            </div>
            <Button type="submit" disabled={create.isPending} className="w-full">
              {create.isPending ? "Creating…" : "Create department"}
            </Button>
          </form>
        </section>
      )}
    </div>
  );
}

function EditRow({
  dept,
  onDone,
  onCancel,
}: {
  dept: { id: string; name: string; slug: string; description: string | null };
  onDone: () => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, formState } = useForm<DepartmentValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: dept.name, slug: dept.slug, description: dept.description ?? "" },
  });
  const updFn = useServerFn(updateDepartment);
  const update = useMutation({
    mutationFn: async (v: DepartmentValues) => updFn({ data: { departmentId: dept.id, ...v } }),
    onSuccess: () => {
      toast.success("Department updated");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <li className="py-3">
      <form onSubmit={handleSubmit((v) => update.mutate(v))} className="grid gap-2 md:grid-cols-3">
        <div>
          <Input {...register("name")} placeholder="Name" />
          {formState.errors.name && (
            <p className="mt-1 text-xs text-destructive">{formState.errors.name.message}</p>
          )}
        </div>
        <div>
          <Input {...register("slug")} placeholder="slug" />
          {formState.errors.slug && (
            <p className="mt-1 text-xs text-destructive">{formState.errors.slug.message}</p>
          )}
        </div>
        <Input {...register("description")} placeholder="Description" />
        <div className="md:col-span-3 flex justify-end gap-1">
          <Button type="button" size="icon" variant="ghost" onClick={onCancel} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
          <Button type="submit" size="icon" disabled={update.isPending} aria-label="Save">
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </li>
  );
}
