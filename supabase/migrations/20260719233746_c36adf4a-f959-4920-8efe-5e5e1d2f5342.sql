CREATE OR REPLACE FUNCTION public.get_teams_dashboard_stats(_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                        WHERE p.organization_id = _org AND p.status = 'active' AND p.team_id IS NOT NULL),
    'pending_tasks',  (SELECT count(*) FROM public.tasks tk
                        WHERE tk.organization_id = _org AND tk.status NOT IN ('done','cancelled'))
  ) INTO _res;
  RETURN _res;
END $function$;