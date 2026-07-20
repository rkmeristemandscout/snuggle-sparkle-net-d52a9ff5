
-- 1. plans: restrict to authenticated users
DROP POLICY IF EXISTS plans_read_all ON public.plans;
CREATE POLICY plans_read_authenticated ON public.plans
  FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.plans FROM anon;

-- 2. roles / permissions / role_permissions: admin/owner-only read
DROP POLICY IF EXISTS "roles readable by authenticated" ON public.roles;
DROP POLICY IF EXISTS "permissions readable by authenticated" ON public.permissions;
DROP POLICY IF EXISTS "role_permissions readable by authenticated" ON public.role_permissions;

CREATE POLICY roles_read_admins ON public.roles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.role IN ('owner'::org_role, 'admin'::org_role)
    )
  );

CREATE POLICY permissions_read_admins ON public.permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.role IN ('owner'::org_role, 'admin'::org_role)
    )
  );

CREATE POLICY role_permissions_read_admins ON public.role_permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.role IN ('owner'::org_role, 'admin'::org_role)
    )
  );

-- 3. tasks_update_involved: mirror USING clause in WITH CHECK to prevent
-- broader changes than intended (e.g. reassigning outside the allowed scope).
DROP POLICY IF EXISTS tasks_update_involved ON public.tasks;
CREATE POLICY tasks_update_involved ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    has_org_role(organization_id, auth.uid(), ARRAY['owner'::org_role, 'admin'::org_role])
    OR created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = tasks.project_id
        AND (p.owner_id = auth.uid() OR p.created_by = auth.uid())
    )
  )
  WITH CHECK (
    has_org_role(organization_id, auth.uid(), ARRAY['owner'::org_role, 'admin'::org_role])
    OR created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = tasks.project_id
        AND (p.owner_id = auth.uid() OR p.created_by = auth.uid())
    )
  );
