
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_organization_id_slug_key;
ALTER TABLE public.departments DROP CONSTRAINT IF EXISTS departments_organization_id_slug_key;

CREATE UNIQUE INDEX IF NOT EXISTS teams_org_slug_unique_alive
  ON public.teams (organization_id, slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS departments_org_slug_unique_alive
  ON public.departments (organization_id, slug) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teams_org_created ON public.teams (organization_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_teams_archived ON public.teams (organization_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_teams_deleted ON public.teams (organization_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_teams_name_trgm ON public.teams USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_departments_org_created ON public.departments (organization_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_departments_archived ON public.departments (organization_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_departments_deleted ON public.departments (organization_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_departments_manager ON public.departments (manager_id);
CREATE INDEX IF NOT EXISTS idx_departments_name_trgm ON public.departments USING gin (name gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_teams_updated_at ON public.teams;
CREATE TRIGGER trg_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_departments_updated_at ON public.departments;
CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_teams_audit ON public.teams;
CREATE TRIGGER trg_teams_audit AFTER INSERT OR UPDATE OR DELETE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.audit_crud();
DROP TRIGGER IF EXISTS trg_departments_audit ON public.departments;
CREATE TRIGGER trg_departments_audit AFTER INSERT OR UPDATE OR DELETE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.audit_crud();
DROP TRIGGER IF EXISTS trg_team_created_activity ON public.teams;
CREATE TRIGGER trg_team_created_activity AFTER INSERT ON public.teams FOR EACH ROW EXECUTE FUNCTION public.on_team_created();
DROP TRIGGER IF EXISTS trg_department_created_activity ON public.departments;
CREATE TRIGGER trg_department_created_activity AFTER INSERT ON public.departments FOR EACH ROW EXECUTE FUNCTION public.on_department_created_activity();
DROP TRIGGER IF EXISTS trg_team_owner_seed ON public.teams;
CREATE TRIGGER trg_team_owner_seed AFTER INSERT ON public.teams FOR EACH ROW EXECUTE FUNCTION public.add_team_owner_as_member();
DROP TRIGGER IF EXISTS trg_team_owner_sync ON public.teams;
CREATE TRIGGER trg_team_owner_sync AFTER UPDATE OF owner_id ON public.teams FOR EACH ROW EXECUTE FUNCTION public.sync_team_owner_membership();

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.teams; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.departments; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE OR REPLACE FUNCTION public.archive_team(_team UUID, _archive BOOLEAN)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_manage_team(_team, _uid) THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  UPDATE public.teams SET archived_at = CASE WHEN _archive THEN now() ELSE NULL END WHERE id = _team;
END; $$;

CREATE OR REPLACE FUNCTION public.soft_delete_team(_team UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_manage_team(_team, _uid) THEN RAISE EXCEPTION 'Insufficient permissions'; END IF;
  UPDATE public.teams SET deleted_at = now(), archived_at = COALESCE(archived_at, now()) WHERE id = _team;
END; $$;

CREATE OR REPLACE FUNCTION public.restore_team(_team UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _org UUID; _slug TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT organization_id, slug INTO _org, _slug FROM public.teams WHERE id = _team;
  IF _org IS NULL THEN RAISE EXCEPTION 'Team not found'; END IF;
  IF NOT public.has_org_role(_org, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  IF EXISTS (SELECT 1 FROM public.teams WHERE organization_id = _org AND id <> _team AND deleted_at IS NULL AND slug = _slug) THEN
    RAISE EXCEPTION 'Another active team already uses this slug';
  END IF;
  UPDATE public.teams SET deleted_at = NULL, archived_at = NULL WHERE id = _team;
END; $$;

CREATE OR REPLACE FUNCTION public.archive_department(_dept UUID, _archive BOOLEAN)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _org UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT organization_id INTO _org FROM public.departments WHERE id = _dept;
  IF _org IS NULL THEN RAISE EXCEPTION 'Department not found'; END IF;
  IF NOT public.has_org_role(_org, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions'; END IF;
  UPDATE public.departments SET archived_at = CASE WHEN _archive THEN now() ELSE NULL END WHERE id = _dept;
END; $$;

CREATE OR REPLACE FUNCTION public.soft_delete_department(_dept UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _org UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT organization_id INTO _org FROM public.departments WHERE id = _dept;
  IF _org IS NULL THEN RAISE EXCEPTION 'Department not found'; END IF;
  IF NOT public.has_org_role(_org, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions'; END IF;
  UPDATE public.departments SET deleted_at = now(), archived_at = COALESCE(archived_at, now()) WHERE id = _dept;
END; $$;

CREATE OR REPLACE FUNCTION public.restore_department(_dept UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _org UUID; _slug TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT organization_id, slug INTO _org, _slug FROM public.departments WHERE id = _dept;
  IF _org IS NULL THEN RAISE EXCEPTION 'Department not found'; END IF;
  IF NOT public.has_org_role(_org, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF EXISTS (SELECT 1 FROM public.departments WHERE organization_id = _org AND id <> _dept AND deleted_at IS NULL AND slug = _slug) THEN
    RAISE EXCEPTION 'Another active department already uses this slug';
  END IF;
  UPDATE public.departments SET deleted_at = NULL, archived_at = NULL WHERE id = _dept;
END; $$;

CREATE OR REPLACE FUNCTION public.set_department_manager(_dept UUID, _manager UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _org UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT organization_id INTO _org FROM public.departments WHERE id = _dept;
  IF _org IS NULL THEN RAISE EXCEPTION 'Department not found'; END IF;
  IF NOT public.has_org_role(_org, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions'; END IF;
  IF _manager IS NOT NULL AND NOT public.is_org_member(_org, _manager) THEN
    RAISE EXCEPTION 'Manager must be a member of the organization';
  END IF;
  UPDATE public.departments SET manager_id = _manager WHERE id = _dept;
END; $$;

GRANT EXECUTE ON FUNCTION public.archive_team(UUID,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_team(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_team(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_department(UUID,BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_department(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_department(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_department_manager(UUID,UUID) TO authenticated;
