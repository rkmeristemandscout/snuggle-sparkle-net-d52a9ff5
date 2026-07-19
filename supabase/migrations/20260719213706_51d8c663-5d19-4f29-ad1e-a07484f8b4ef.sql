
ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS cost_center text,
  ADD COLUMN IF NOT EXISTS budget numeric(14,2),
  ADD COLUMN IF NOT EXISTS budget_currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS headcount_limit integer,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE UNIQUE INDEX IF NOT EXISTS departments_org_code_unique_alive
  ON public.departments (organization_id, lower(code))
  WHERE code IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS departments_org_status_idx
  ON public.departments (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_department_tree(_org uuid)
RETURNS TABLE (id uuid, parent_id uuid, name text, slug text, manager_id uuid, depth int, path uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE tree AS (
    SELECT d.id, d.parent_id, d.name, d.slug, d.manager_id, 0 AS depth, ARRAY[d.id] AS path
    FROM public.departments d
    WHERE d.organization_id = _org AND d.deleted_at IS NULL AND d.parent_id IS NULL
      AND public.is_org_member(_org, auth.uid())
    UNION ALL
    SELECT d.id, d.parent_id, d.name, d.slug, d.manager_id, t.depth + 1, t.path || d.id
    FROM public.departments d JOIN tree t ON d.parent_id = t.id
    WHERE d.organization_id = _org AND d.deleted_at IS NULL AND NOT d.id = ANY(t.path)
  )
  SELECT * FROM tree ORDER BY path;
$$;
REVOKE ALL ON FUNCTION public.get_department_tree(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_department_tree(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_department_rollup(_dept uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_ids uuid[];
  v_members int; v_direct int; v_projects int; v_tasks int; v_open_tasks int;
BEGIN
  SELECT organization_id INTO v_org FROM public.departments WHERE id = _dept;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Department not found'; END IF;
  IF NOT public.is_org_member(v_org, auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;

  WITH RECURSIVE sub AS (
    SELECT id FROM public.departments WHERE id = _dept AND deleted_at IS NULL
    UNION ALL
    SELECT d.id FROM public.departments d JOIN sub s ON d.parent_id = s.id WHERE d.deleted_at IS NULL
  )
  SELECT array_agg(id) INTO v_ids FROM sub;

  SELECT count(*) INTO v_direct FROM public.organization_members
   WHERE organization_id = v_org AND department_id = _dept;
  SELECT count(*) INTO v_members FROM public.organization_members
   WHERE organization_id = v_org AND department_id = ANY(v_ids);
  SELECT count(*) INTO v_projects FROM public.projects
   WHERE organization_id = v_org AND (metadata->>'department_id')::uuid = ANY(v_ids);
  SELECT count(*), count(*) FILTER (WHERE status <> 'done') INTO v_tasks, v_open_tasks
   FROM public.tasks
   WHERE organization_id = v_org AND (metadata->>'department_id')::uuid = ANY(v_ids);

  RETURN jsonb_build_object(
    'direct_members', v_direct, 'total_members', v_members,
    'sub_department_count', COALESCE(array_length(v_ids,1),1) - 1,
    'projects', v_projects, 'tasks', v_tasks, 'open_tasks', v_open_tasks
  );
END; $$;
REVOKE ALL ON FUNCTION public.get_department_rollup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_department_rollup(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_department_members(_from uuid, _to uuid, _users uuid[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_org_to uuid; v_updated int;
BEGIN
  SELECT organization_id INTO v_org FROM public.departments WHERE id = _from;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Source department not found'; END IF;
  IF _to IS NOT NULL THEN
    SELECT organization_id INTO v_org_to FROM public.departments WHERE id = _to;
    IF v_org_to IS NULL OR v_org_to <> v_org THEN
      RAISE EXCEPTION 'Target department must be in the same organization';
    END IF;
  END IF;
  IF NOT (public.has_permission(auth.uid(), v_org, 'department.update')
       OR public.has_permission(auth.uid(), v_org, 'department.manage')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.organization_members SET department_id = _to
   WHERE organization_id = v_org AND department_id = _from AND user_id = ANY(_users);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  PERFORM public.log_activity_safe(v_org, auth.uid(), 'department.transfer_members',
    'department', _from, format('Transferred %s member(s) from department', v_updated),
    jsonb_build_object('to', _to, 'count', v_updated));
  RETURN v_updated;
END; $$;
REVOKE ALL ON FUNCTION public.transfer_department_members(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_department_members(uuid, uuid, uuid[]) TO authenticated;
