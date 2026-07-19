
-- ============ PROJECTS ============
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning','active','on_hold','completed','archived')),
  color TEXT,
  due_date DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select_org_members" ON public.projects
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "projects_insert_members" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id, auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "projects_update_admin_or_owner" ON public.projects
  FOR UPDATE TO authenticated
  USING (
    public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
    OR owner_id = auth.uid()
    OR created_by = auth.uid()
  )
  WITH CHECK (
    public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
    OR owner_id = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY "projects_delete_admin_or_owner" ON public.projects
  FOR DELETE TO authenticated
  USING (
    public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
    OR owner_id = auth.uid()
    OR created_by = auth.uid()
  );

CREATE INDEX IF NOT EXISTS projects_org_created_idx ON public.projects (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projects_team_idx ON public.projects (team_id);
CREATE INDEX IF NOT EXISTS projects_owner_idx ON public.projects (owner_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON public.projects (organization_id, status);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER projects_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_crud();

-- ============ TASKS ============
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','in_review','done','cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  due_date DATE,
  position INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select_org_members" ON public.tasks
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "tasks_insert_members" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id, auth.uid())
    AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.organization_id = tasks.organization_id)
  );

CREATE POLICY "tasks_update_involved" ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
    OR created_by = auth.uid()
    OR assignee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR p.created_by = auth.uid()))
  )
  WITH CHECK (
    public.is_org_member(organization_id, auth.uid())
  );

CREATE POLICY "tasks_delete_involved" ON public.tasks
  FOR DELETE TO authenticated
  USING (
    public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
    OR created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR p.created_by = auth.uid()))
  );

CREATE INDEX IF NOT EXISTS tasks_org_created_idx ON public.tasks (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON public.tasks (project_id, position);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON public.tasks (assignee_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON public.tasks (organization_id, status);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON public.tasks (organization_id, due_date);

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tasks_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_crud();

-- Auto-set completed_at when status transitions to done
CREATE OR REPLACE FUNCTION public.tasks_mark_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS NULL OR OLD.status <> 'done') THEN
    NEW.completed_at = now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tasks_mark_completed_trg
  BEFORE INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_mark_completed();

-- Activity + notification when project created
CREATE OR REPLACE FUNCTION public.on_project_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor UUID := auth.uid(); _actor_name TEXT;
BEGIN
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = _actor;
  INSERT INTO public.activity_logs (organization_id, actor_id, action, entity_type, entity_id, summary, metadata)
  VALUES (NEW.organization_id, _actor, 'project.created', 'project', NEW.id,
    _actor_name || ' created project ' || NEW.name,
    jsonb_build_object('project_name', NEW.name));
  PERFORM public.notify_org_members(
    NEW.organization_id, _actor, 'project.created',
    'New project created', _actor_name || ' created project ' || NEW.name,
    '/projects', jsonb_build_object('project_id', NEW.id));
  RETURN NEW;
END $$;

CREATE TRIGGER on_project_created_trg
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.on_project_created();

-- Notify assignee when assigned
CREATE OR REPLACE FUNCTION public.on_task_assigned()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor UUID := auth.uid(); _actor_name TEXT;
BEGIN
  IF NEW.assignee_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id THEN RETURN NEW; END IF;
  IF NEW.assignee_id = _actor THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = _actor;
  INSERT INTO public.notifications (user_id, organization_id, type, title, message, link, metadata)
  VALUES (NEW.assignee_id, NEW.organization_id, 'task.assigned',
    'You were assigned a task',
    _actor_name || ' assigned you: ' || NEW.title,
    '/tasks', jsonb_build_object('task_id', NEW.id, 'project_id', NEW.project_id));
  RETURN NEW;
END $$;

CREATE TRIGGER on_task_assigned_trg
  AFTER INSERT OR UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.on_task_assigned();

-- Analytics helper: aggregated snapshot for the current org
CREATE OR REPLACE FUNCTION public.get_analytics_snapshot(_org UUID)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _result JSONB;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_org_member(_org, _uid) THEN RAISE EXCEPTION 'Not a member of the organization'; END IF;
  SELECT jsonb_build_object(
    'members', (SELECT count(*) FROM public.organization_members WHERE organization_id = _org),
    'teams', (SELECT count(*) FROM public.teams WHERE organization_id = _org),
    'departments', (SELECT count(*) FROM public.departments WHERE organization_id = _org),
    'projects_total', (SELECT count(*) FROM public.projects WHERE organization_id = _org),
    'projects_active', (SELECT count(*) FROM public.projects WHERE organization_id = _org AND status = 'active'),
    'tasks_total', (SELECT count(*) FROM public.tasks WHERE organization_id = _org),
    'tasks_open', (SELECT count(*) FROM public.tasks WHERE organization_id = _org AND status NOT IN ('done','cancelled')),
    'tasks_done_7d', (SELECT count(*) FROM public.tasks WHERE organization_id = _org AND status = 'done' AND completed_at > now() - INTERVAL '7 days'),
    'invites_pending', (SELECT count(*) FROM public.organization_invitations WHERE organization_id = _org AND accepted_at IS NULL AND rejected_at IS NULL AND expires_at > now()),
    'activity_30d', (SELECT count(*) FROM public.activity_logs WHERE organization_id = _org AND created_at > now() - INTERVAL '30 days'),
    'audit_30d', (SELECT count(*) FROM public.audit_logs WHERE organization_id = _org AND created_at > now() - INTERVAL '30 days'),
    'generated_at', now()
  ) INTO _result;
  RETURN _result;
END $$;

-- Complementary indexes on high-traffic logs (idempotent)
CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx ON public.audit_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_org_created_idx ON public.activity_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_read_idx ON public.notifications (user_id, read_at);
