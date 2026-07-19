
-- Extend projects table
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS client text,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget numeric(14,2),
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_priority_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_priority_check
  CHECK (priority IN ('low','medium','high','urgent'));

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_progress_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_progress_check
  CHECK (progress >= 0 AND progress <= 100);

-- Unique code per org (case-insensitive), only when not soft-deleted
CREATE UNIQUE INDEX IF NOT EXISTS projects_org_code_unique
  ON public.projects (organization_id, lower(code))
  WHERE code IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS projects_org_name_unique
  ON public.projects (organization_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_org_status_idx ON public.projects (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_org_priority_idx ON public.projects (organization_id, priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS projects_manager_idx ON public.projects (manager_id);
CREATE INDEX IF NOT EXISTS projects_department_idx ON public.projects (department_id);

-- Project members table
CREATE TABLE IF NOT EXISTS public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('manager','lead','member','viewer')),
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS project_members_project_idx ON public.project_members (project_id);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON public.project_members (user_id);
CREATE INDEX IF NOT EXISTS project_members_org_idx ON public.project_members (organization_id);

DROP POLICY IF EXISTS pm_select ON public.project_members;
CREATE POLICY pm_select ON public.project_members FOR SELECT
  USING (is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS pm_insert ON public.project_members;
CREATE POLICY pm_insert ON public.project_members FOR INSERT
  WITH CHECK (
    is_org_member(organization_id, auth.uid())
    AND (
      has_org_role(organization_id, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role])
      OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id
                 AND (p.owner_id = auth.uid() OR p.manager_id = auth.uid() OR p.created_by = auth.uid()))
    )
  );

DROP POLICY IF EXISTS pm_update ON public.project_members;
CREATE POLICY pm_update ON public.project_members FOR UPDATE
  USING (
    has_org_role(organization_id, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role])
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id
               AND (p.owner_id = auth.uid() OR p.manager_id = auth.uid()))
  );

DROP POLICY IF EXISTS pm_delete ON public.project_members;
CREATE POLICY pm_delete ON public.project_members FOR DELETE
  USING (
    has_org_role(organization_id, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role])
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id
               AND (p.owner_id = auth.uid() OR p.manager_id = auth.uid()))
    OR user_id = auth.uid()
  );

-- Duplicate project RPC
CREATE OR REPLACE FUNCTION public.duplicate_project(_project_id uuid, _new_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  src record;
  new_id uuid;
  base_slug text;
  new_slug text;
  new_code text;
  suffix int := 1;
BEGIN
  SELECT * INTO src FROM public.projects WHERE id = _project_id;
  IF src IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;

  IF NOT (
    is_org_member(src.organization_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  base_slug := regexp_replace(lower(coalesce(_new_name, src.name || '-copy')), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  new_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM public.projects WHERE organization_id = src.organization_id AND slug = new_slug) LOOP
    new_slug := base_slug || '-' || suffix;
    suffix := suffix + 1;
  END LOOP;

  new_code := CASE WHEN src.code IS NOT NULL THEN src.code || '-COPY' ELSE NULL END;
  suffix := 1;
  WHILE new_code IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.projects
    WHERE organization_id = src.organization_id AND lower(code) = lower(new_code) AND deleted_at IS NULL
  ) LOOP
    new_code := src.code || '-COPY' || suffix;
    suffix := suffix + 1;
  END LOOP;

  INSERT INTO public.projects (
    organization_id, team_id, owner_id, name, slug, description, status, color, due_date, created_by,
    code, client, department_id, manager_id, priority, progress, budget, start_date, tags, cover_image_url, logo_url
  ) VALUES (
    src.organization_id, src.team_id, src.owner_id,
    coalesce(_new_name, src.name || ' (Copy)'), new_slug,
    src.description, 'planning', src.color, src.due_date, auth.uid(),
    new_code, src.client, src.department_id, src.manager_id, src.priority, 0, src.budget, src.start_date,
    src.tags, src.cover_image_url, src.logo_url
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_project(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.duplicate_project(uuid, text) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.project_members;
