
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_status_check') THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_status_check
      CHECK (status IN ('active','archived','on_hold'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS teams_status_idx ON public.teams(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS teams_owner_idx ON public.teams(organization_id, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS teams_department_idx ON public.teams(organization_id, department_id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_teams_dashboard_stats(_org uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _res jsonb;
BEGIN
  IF NOT public.is_org_member(_org, auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT jsonb_build_object(
    'total_teams',    (SELECT count(*) FROM public.teams WHERE organization_id = _org AND deleted_at IS NULL),
    'active_teams',   (SELECT count(*) FROM public.teams WHERE organization_id = _org AND deleted_at IS NULL AND archived_at IS NULL),
    'archived_teams', (SELECT count(*) FROM public.teams WHERE organization_id = _org AND deleted_at IS NULL AND archived_at IS NOT NULL),
    'total_members',  (SELECT count(DISTINCT tm.user_id) FROM public.team_members tm
                         JOIN public.teams t ON t.id = tm.team_id
                        WHERE t.organization_id = _org AND t.deleted_at IS NULL),
    'active_projects',(SELECT count(*) FROM public.projects p
                        WHERE p.organization_id = _org AND p.deleted_at IS NULL AND p.status = 'active' AND p.team_id IS NOT NULL),
    'pending_tasks',  (SELECT count(*) FROM public.tasks tk
                        WHERE tk.organization_id = _org AND tk.status NOT IN ('done','cancelled'))
  ) INTO _res;
  RETURN _res;
END $fn$;
