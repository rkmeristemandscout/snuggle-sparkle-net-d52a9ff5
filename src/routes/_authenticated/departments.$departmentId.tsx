import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { departmentSchema, type DepartmentValues } from "@/lib/auth-schemas";
import {
  getDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentStats,
  getDepartmentActivity,
  getDepartmentMembers,
  bulkAssignDepartmentMembers,
  setDepartmentParent,
  setDepartmentManager,
  listDepartments,
} from "@/lib/departments.functions";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Download, Users, GitBranch, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/_authenticated/departments/$departmentId")({
  component: DepartmentDetail,
});

function toCsv(rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function DepartmentDetail() {
  const { departmentId } = useParams({ from: "/_authenticated/departments/$departmentId" });
  const { currentMembership } = useCurrentOrg();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const canManage =
    currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const orgId = currentMembership?.organization.id;

  const getDeptFn = useServerFn(getDepartment);
  const getStatsFn = useServerFn(getDepartmentStats);
  const getActivityFn = useServerFn(getDepartmentActivity);
  const getMembersFn = useServerFn(getDepartmentMembers);
  const listDeptsFn = useServerFn(listDepartments);
  const updateDeptFn = useServerFn(updateDepartment);
  const deleteDeptFn = useServerFn(deleteDepartment);
  const bulkAssignFn = useServerFn(bulkAssignDepartmentMembers);
  const setParentFn = useServerFn(setDepartmentParent);
  const setManagerFn = useServerFn(setDepartmentManager);

  const dept = useQuery({
    queryKey: ["dept", departmentId],
    queryFn: () => getDeptFn({ data: { departmentId } }),
  });

  const stats = useQuery({
    queryKey: ["dept-stats", departmentId],
    queryFn: () => getStatsFn({ data: { departmentId } }),
  });

  const activity = useQuery({
    queryKey: ["dept-activity", departmentId],
    queryFn: () => getActivityFn({ data: { departmentId, limit: 30 } }),
  });

  const members = useQuery({
    queryKey: ["dept-members", departmentId],
    queryFn: () => getMembersFn({ data: { departmentId } }),
  });

  const siblings = useQuery({
    enabled: !!orgId,
    queryKey: ["depts-list-for-parent", orgId],
    queryFn: () =>
      listDeptsFn({ data: { organizationId: orgId!, status: "active", limit: 100 } }),
  });

  const orgMembers = useQuery({
    enabled: !!orgId,
    queryKey: ["org-members-for-dept", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("user_id, role, department_id")
        .eq("organization_id", orgId!);
      if (error) throw error;
      const ids = (data ?? []).map((m) => m.user_id);
      let profs: Record<string, { full_name: string | null }> = {};
      if (ids.length) {
        const { data: p } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        profs = Object.fromEntries((p ?? []).map((x) => [x.id, x]));
      }
      return (data ?? []).map((m) => ({ ...m, profile: profs[m.user_id] ?? null }));
    },
  });

  const { register, handleSubmit, reset, formState } = useForm<DepartmentValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: { name: "", slug: "", description: "" },
  });

  useEffect(() => {
    if (dept.data) {
      reset({
        name: dept.data.name,
        slug: dept.data.slug,
        description: dept.data.description ?? "",
      });
    }
  }, [dept.data, reset]);

  const save = useMutation({
    mutationFn: (v: DepartmentValues) => updateDeptFn({ data: { departmentId, ...v } }),
    onSuccess: () => {
      toast.success("Department updated");
      qc.invalidateQueries({ queryKey: ["dept", departmentId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => deleteDeptFn({ data: { departmentId } }),
    onSuccess: () => {
      toast.success("Department deleted");
      navigate({ to: "/departments" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [parentId, setParentId] = useState<string>("");
  useEffect(() => {
    const p = (dept.data as { parent_id?: string | null } | undefined)?.parent_id;
    if (dept.data) setParentId(p ?? "__none");
  }, [dept.data]);

  const saveParent = useMutation({
    mutationFn: () =>
      setParentFn({
        data: { departmentId, parentId: parentId === "__none" ? null : parentId },
      }),
    onSuccess: () => {
      toast.success("Hierarchy updated");
      qc.invalidateQueries({ queryKey: ["dept", departmentId] });
      qc.invalidateQueries({ queryKey: ["dept-stats", departmentId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [managerId, setManagerId] = useState<string>("__none");
  useEffect(() => {
    if (dept.data) setManagerId(dept.data.manager_id ?? "__none");
  }, [dept.data]);

  const saveManager = useMutation({
    mutationFn: () =>
      setManagerFn({
        data: { departmentId, managerId: managerId === "__none" ? null : managerId },
      }),
    onSuccess: () => {
      toast.success("Manager updated");
      qc.invalidateQueries({ queryKey: ["dept", departmentId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [selectedUsers, setSelectedUsers] = useState<Record<string, boolean>>({});
  const bulkAssign = useMutation({
    mutationFn: (userIds: string[]) => bulkAssignFn({ data: { departmentId, userIds } }),
    onSuccess: (r) => {
      toast.success(`Assigned ${r.assigned} member(s)`);
      setSelectedUsers({});
      qc.invalidateQueries({ queryKey: ["dept-members", departmentId] });
      qc.invalidateQueries({ queryKey: ["dept-stats", departmentId] });
      qc.invalidateQueries({ queryKey: ["org-members-for-dept", orgId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentMemberIds = useMemo(
    () => new Set((members.data ?? []).map((m) => m.user_id)),
    [members.data],
  );

  const assignable = useMemo(
    () => (orgMembers.data ?? []).filter((m) => !currentMemberIds.has(m.user_id)),
    [orgMembers.data, currentMemberIds],
  );

  const exportCsv = () => {
    const rows = (members.data ?? []).map((m) => ({
      user_id: m.user_id,
      full_name: m.profile?.full_name ?? "",
      org_role: m.role,
      joined_at: m.created_at,
    }));
    downloadCsv(`department-${dept.data?.slug ?? departmentId}-members.csv`, toCsv(rows));
  };

  if (dept.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!dept.data) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Department not found</h2>
        <Link to="/departments" className="mt-4 inline-block text-sm underline">
          Back to departments
        </Link>
      </div>
    );
  }

  const s = stats.data;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/departments" className="text-sm text-muted-foreground hover:underline">
          ← All departments
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{dept.data.name}</h1>
        <p className="text-sm text-muted-foreground">/{dept.data.slug}</p>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={<Users className="h-4 w-4" />} label="Members" value={s?.member_count ?? "—"} />
        <StatCard icon={<GitBranch className="h-4 w-4" />} label="Sub-departments" value={s?.child_count ?? "—"} />
        <StatCard
          icon={<CalendarDays className="h-4 w-4" />}
          label="Created"
          value={s ? new Date(s.created_at).toLocaleDateString() : "—"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Members */}
        <section className="rounded-xl border bg-card p-6 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Members</h2>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
          </div>
          {members.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          ) : members.data && members.data.length ? (
            <ul className="mt-4 divide-y">
              {members.data.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">
                      {m.profile?.full_name ?? m.user_id.slice(0, 8)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Joined {new Date(m.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="secondary">{m.role}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No members yet.</p>
          )}

          {canManage && (
            <div className="mt-6 border-t pt-4">
              <h3 className="text-sm font-semibold">Bulk assign members</h3>
              <p className="text-xs text-muted-foreground">
                Move selected organization members into this department.
              </p>
              <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded border p-2">
                {assignable.length === 0 && (
                  <p className="text-xs text-muted-foreground">No members available to assign.</p>
                )}
                {assignable.map((m) => (
                  <label
                    key={m.user_id}
                    className="flex cursor-pointer items-center gap-2 rounded p-1 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={!!selectedUsers[m.user_id]}
                      onCheckedChange={(v) =>
                        setSelectedUsers((s) => ({ ...s, [m.user_id]: !!v }))
                      }
                    />
                    <span className="flex-1">
                      {m.profile?.full_name ?? m.user_id.slice(0, 8)}
                    </span>
                    <span className="text-xs text-muted-foreground">{m.role}</span>
                  </label>
                ))}
              </div>
              <Button
                className="mt-3"
                size="sm"
                disabled={
                  bulkAssign.isPending ||
                  Object.values(selectedUsers).every((v) => !v)
                }
                onClick={() =>
                  bulkAssign.mutate(
                    Object.entries(selectedUsers).filter(([, v]) => v).map(([k]) => k),
                  )
                }
              >
                Assign selected
              </Button>
            </div>
          )}
        </section>

        <div className="space-y-6 lg:col-span-2">
          {/* Settings */}
          <section className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold">Settings</h2>
            {canManage ? (
              <form onSubmit={handleSubmit((v) => save.mutate(v))} className="mt-4 space-y-4">
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
                Only owners or admins can edit settings.
              </p>
            )}
          </section>

          {/* Hierarchy */}
          {canManage && (
            <section className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">Hierarchy</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose an optional parent department.
              </p>
              <div className="mt-3 flex items-end gap-2">
                <div className="flex-1">
                  <Select value={parentId} onValueChange={setParentId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select parent…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No parent</SelectItem>
                      {(siblings.data?.rows ?? [])
                        .filter((d) => d.id !== departmentId)
                        .map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={saveParent.isPending}
                  onClick={() => saveParent.mutate()}
                >
                  Save
                </Button>
              </div>
            </section>
          )}

          {/* Manager */}
          {canManage && (
            <section className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">Manager</h2>
              <div className="mt-3 flex items-end gap-2">
                <div className="flex-1">
                  <Select value={managerId} onValueChange={setManagerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select manager…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No manager</SelectItem>
                      {(orgMembers.data ?? []).map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.profile?.full_name ?? m.user_id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button disabled={saveManager.isPending} onClick={() => saveManager.mutate()}>
                  Save
                </Button>
              </div>
            </section>
          )}

          {canManage && (
            <section className="rounded-xl border border-destructive/40 bg-card p-6">
              <h2 className="text-lg font-semibold text-destructive">Delete department</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Soft-deletes the department. Members become unassigned.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="mt-4">
                    Delete department
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {dept.data.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This can be restored from the departments list.
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

      {/* Activity timeline */}
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Activity</h2>
        {activity.isLoading ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : activity.data && activity.data.length ? (
          <ul className="mt-4 space-y-3">
            {activity.data.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 border-l-2 border-primary/40 pl-3">
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

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}
