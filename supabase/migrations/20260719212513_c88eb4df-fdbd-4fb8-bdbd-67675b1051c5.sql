
-- 1. Columns
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_departments_parent ON public.departments(parent_id) WHERE parent_id IS NOT NULL;

-- 2. Team stats
CREATE OR REPLACE FUNCTION public.get_team_stats(_team uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _member_count int;
  _project_count int;
  _created timestamptz;
  _owner uuid;
BEGIN
  SELECT organization_id, created_at, owner_id INTO _org, _created, _owner
  FROM public.teams WHERE id = _team;
  IF _org IS NULL THEN RETURN NULL; END IF;
  IF NOT public.is_org_member(_org, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  SELECT count(*) INTO _member_count FROM public.team_members WHERE team_id = _team;
  SELECT count(*) INTO _project_count FROM public.projects WHERE team_id = _team AND deleted_at IS NULL;
  RETURN jsonb_build_object(
    'member_count', _member_count,
    'project_count', _project_count,
    'created_at', _created,
    'owner_id', _owner
  );
END;
$$;

-- 3. Department stats
CREATE OR REPLACE FUNCTION public.get_department_stats(_dept uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _member_count int;
  _child_count int;
  _created timestamptz;
  _manager uuid;
BEGIN
  SELECT organization_id, created_at, manager_id INTO _org, _created, _manager
  FROM public.departments WHERE id = _dept;
  IF _org IS NULL THEN RETURN NULL; END IF;
  IF NOT public.is_org_member(_org, auth.uid()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  SELECT count(*) INTO _member_count
  FROM public.organization_members WHERE department_id = _dept;
  SELECT count(*) INTO _child_count
  FROM public.departments WHERE parent_id = _dept AND deleted_at IS NULL;
  RETURN jsonb_build_object(
    'member_count', _member_count,
    'child_count', _child_count,
    'created_at', _created,
    'manager_id', _manager
  );
END;
$$;

-- 4. Bulk add team members
CREATE OR REPLACE FUNCTION public.bulk_add_team_members(_team uuid, _users uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _added int := 0;
  _uid uuid;
BEGIN
  SELECT organization_id INTO _org FROM public.teams WHERE id = _team;
  IF _org IS NULL THEN RAISE EXCEPTION 'Team not found'; END IF;
  IF NOT public.can_manage_team(_team, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to manage team';
  END IF;

  FOREACH _uid IN ARRAY _users LOOP
    -- must be an org member
    IF EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = _org AND user_id = _uid
    ) THEN
      INSERT INTO public.team_members (team_id, user_id, role)
      VALUES (_team, _uid, 'member')
      ON CONFLICT (team_id, user_id) DO NOTHING;
      IF FOUND THEN _added := _added + 1; END IF;
    END IF;
  END LOOP;

  PERFORM public.log_activity_safe(
    _org, auth.uid(), 'team.members.bulk_add', 'team', _team,
    format('Added %s member(s) to team', _added),
    jsonb_build_object('added', _added, 'requested', array_length(_users, 1))
  );
  RETURN _added;
END;
$$;

-- 5. Bulk remove team members
CREATE OR REPLACE FUNCTION public.bulk_remove_team_members(_team uuid, _users uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _owner uuid;
  _removed int;
BEGIN
  SELECT organization_id, owner_id INTO _org, _owner FROM public.teams WHERE id = _team;
  IF _org IS NULL THEN RAISE EXCEPTION 'Team not found'; END IF;
  IF NOT public.can_manage_team(_team, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized to manage team';
  END IF;

  WITH del AS (
    DELETE FROM public.team_members
    WHERE team_id = _team AND user_id = ANY(_users) AND user_id <> _owner
    RETURNING 1
  )
  SELECT count(*) INTO _removed FROM del;

  PERFORM public.log_activity_safe(
    _org, auth.uid(), 'team.members.bulk_remove', 'team', _team,
    format('Removed %s member(s) from team', _removed),
    jsonb_build_object('removed', _removed)
  );
  RETURN _removed;
END;
$$;

-- 6. Bulk assign department members
CREATE OR REPLACE FUNCTION public.bulk_assign_department_members(_dept uuid, _users uuid[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _updated int;
BEGIN
  SELECT organization_id INTO _org FROM public.departments WHERE id = _dept;
  IF _org IS NULL THEN RAISE EXCEPTION 'Department not found'; END IF;
  IF NOT public.has_org_role(_org, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  WITH upd AS (
    UPDATE public.organization_members
    SET department_id = _dept
    WHERE organization_id = _org AND user_id = ANY(_users)
    RETURNING 1
  )
  SELECT count(*) INTO _updated FROM upd;

  PERFORM public.log_activity_safe(
    _org, auth.uid(), 'department.members.bulk_assign', 'department', _dept,
    format('Assigned %s member(s) to department', _updated),
    jsonb_build_object('assigned', _updated)
  );
  RETURN _updated;
END;
$$;

-- 7. Set department parent (with cycle prevention)
CREATE OR REPLACE FUNCTION public.set_department_parent(_dept uuid, _parent uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org uuid;
  _porg uuid;
  _cursor uuid;
BEGIN
  SELECT organization_id INTO _org FROM public.departments WHERE id = _dept;
  IF _org IS NULL THEN RAISE EXCEPTION 'Department not found'; END IF;
  IF NOT public.has_org_role(_org, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _parent IS NOT NULL THEN
    SELECT organization_id INTO _porg FROM public.departments WHERE id = _parent;
    IF _porg IS DISTINCT FROM _org THEN
      RAISE EXCEPTION 'Parent must be in the same organization';
    END IF;
    IF _parent = _dept THEN
      RAISE EXCEPTION 'Department cannot be its own parent';
    END IF;
    -- walk up the parent chain to detect cycles
    _cursor := _parent;
    WHILE _cursor IS NOT NULL LOOP
      IF _cursor = _dept THEN
        RAISE EXCEPTION 'Cycle detected in department hierarchy';
      END IF;
      SELECT parent_id INTO _cursor FROM public.departments WHERE id = _cursor;
    END LOOP;
  END IF;

  UPDATE public.departments SET parent_id = _parent WHERE id = _dept;

  PERFORM public.log_activity_safe(
    _org, auth.uid(), 'department.parent.updated', 'department', _dept,
    'Updated department parent',
    jsonb_build_object('parent_id', _parent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_department_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_add_team_members(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_remove_team_members(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_assign_department_members(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_department_parent(uuid, uuid) TO authenticated;

-- 8. Storage policies for team-avatars (path convention: {organization_id}/{team_id}/...)
CREATE POLICY "team-avatars read for org members"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'team-avatars'
  AND public.is_org_member((split_part(name, '/', 1))::uuid, auth.uid())
);

CREATE POLICY "team-avatars write for org admins"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'team-avatars'
  AND public.has_org_role((split_part(name, '/', 1))::uuid, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role])
);

CREATE POLICY "team-avatars update for org admins"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'team-avatars'
  AND public.has_org_role((split_part(name, '/', 1))::uuid, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role])
);

CREATE POLICY "team-avatars delete for org admins"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'team-avatars'
  AND public.has_org_role((split_part(name, '/', 1))::uuid, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role])
);
