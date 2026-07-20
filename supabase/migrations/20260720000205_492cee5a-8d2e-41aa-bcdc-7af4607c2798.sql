
-- Extend tasks table with production-ready fields
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS estimated_hours numeric(10,2),
  ADD COLUMN IF NOT EXISTS logged_hours numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Extend task status to include 'blocked'
DO $$ BEGIN
  ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('todo','in_progress','in_review','blocked','done','cancelled'));

-- Unique code per org (case-insensitive, ignoring deleted)
CREATE UNIQUE INDEX IF NOT EXISTS tasks_org_code_unique
  ON public.tasks (organization_id, lower(code))
  WHERE code IS NOT NULL AND deleted_at IS NULL;

-- Unique task name per project (case-insensitive, ignoring deleted)
CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_title_unique
  ON public.tasks (project_id, lower(title))
  WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS tasks_org_status_idx ON public.tasks (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON public.tasks (assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_due_date_idx ON public.tasks (due_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_team_idx ON public.tasks (team_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_department_idx ON public.tasks (department_id) WHERE deleted_at IS NULL;

-- Child tables
CREATE TABLE IF NOT EXISTS public.task_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  content text NOT NULL,
  is_done boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_checklist TO authenticated;
GRANT ALL ON public.task_checklist TO service_role;
ALTER TABLE public.task_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist_select" ON public.task_checklist FOR SELECT USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "checklist_insert" ON public.task_checklist FOR INSERT WITH CHECK (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "checklist_update" ON public.task_checklist FOR UPDATE USING (public.is_org_member(organization_id, auth.uid())) WITH CHECK (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "checklist_delete" ON public.task_checklist FOR DELETE USING (public.is_org_member(organization_id, auth.uid()));
CREATE INDEX IF NOT EXISTS task_checklist_task_idx ON public.task_checklist(task_id);

CREATE TABLE IF NOT EXISTS public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.task_comments(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments_select" ON public.task_comments FOR SELECT USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "comments_insert" ON public.task_comments FOR INSERT WITH CHECK (public.is_org_member(organization_id, auth.uid()) AND author_id = auth.uid());
CREATE POLICY "comments_update" ON public.task_comments FOR UPDATE USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "comments_delete" ON public.task_comments FOR DELETE USING (author_id = auth.uid() OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role]));
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON public.task_comments(task_id);

CREATE TABLE IF NOT EXISTS public.task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_size bigint,
  mime_type text,
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_attachments TO authenticated;
GRANT ALL ON public.task_attachments TO service_role;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "att_select" ON public.task_attachments FOR SELECT USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "att_insert" ON public.task_attachments FOR INSERT WITH CHECK (public.is_org_member(organization_id, auth.uid()) AND uploaded_by = auth.uid());
CREATE POLICY "att_delete" ON public.task_attachments FOR DELETE USING (uploaded_by = auth.uid() OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role]));
CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON public.task_attachments(task_id);

CREATE TABLE IF NOT EXISTS public.task_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  hours numeric(10,2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_time_entries TO authenticated;
GRANT ALL ON public.task_time_entries TO service_role;
ALTER TABLE public.task_time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "time_select" ON public.task_time_entries FOR SELECT USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "time_insert" ON public.task_time_entries FOR INSERT WITH CHECK (public.is_org_member(organization_id, auth.uid()) AND user_id = auth.uid());
CREATE POLICY "time_update" ON public.task_time_entries FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "time_delete" ON public.task_time_entries FOR DELETE USING (user_id = auth.uid() OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role]));
CREATE INDEX IF NOT EXISTS task_time_task_idx ON public.task_time_entries(task_id);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION public.tasks_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_task_checklist_updated ON public.task_checklist;
CREATE TRIGGER trg_task_checklist_updated BEFORE UPDATE ON public.task_checklist FOR EACH ROW EXECUTE FUNCTION public.tasks_touch_updated_at();
DROP TRIGGER IF EXISTS trg_task_comments_updated ON public.task_comments;
CREATE TRIGGER trg_task_comments_updated BEFORE UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.tasks_touch_updated_at();

-- Aggregate logged_hours when time entry closes
CREATE OR REPLACE FUNCTION public.tasks_recalc_logged_hours() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE _tid uuid;
BEGIN
  _tid := COALESCE(NEW.task_id, OLD.task_id);
  UPDATE public.tasks SET logged_hours = COALESCE((
    SELECT SUM(COALESCE(hours,0)) FROM public.task_time_entries WHERE task_id = _tid
  ),0) WHERE id = _tid;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS trg_time_entries_recalc ON public.task_time_entries;
CREATE TRIGGER trg_time_entries_recalc AFTER INSERT OR UPDATE OR DELETE ON public.task_time_entries
FOR EACH ROW EXECUTE FUNCTION public.tasks_recalc_logged_hours();

-- Auto set completed_at when status flips to done
CREATE OR REPLACE FUNCTION public.tasks_set_completed_at() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at = now();
    NEW.progress = 100;
  ELSIF NEW.status <> 'done' AND OLD.status = 'done' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_tasks_completed ON public.tasks;
CREATE TRIGGER trg_tasks_completed BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tasks_set_completed_at();

-- Stats RPC
CREATE OR REPLACE FUNCTION public.get_tasks_stats(_org uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'total', COUNT(*) FILTER (WHERE deleted_at IS NULL),
    'pending', COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='todo'),
    'in_progress', COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='in_progress'),
    'in_review', COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='in_review'),
    'completed', COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='done'),
    'blocked', COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='blocked'),
    'overdue', COUNT(*) FILTER (WHERE deleted_at IS NULL AND status NOT IN ('done','cancelled') AND due_date IS NOT NULL AND due_date < CURRENT_DATE),
    'high_priority', COUNT(*) FILTER (WHERE deleted_at IS NULL AND priority IN ('high','urgent') AND status NOT IN ('done','cancelled')),
    'due_today', COUNT(*) FILTER (WHERE deleted_at IS NULL AND due_date = CURRENT_DATE AND status NOT IN ('done','cancelled')),
    'due_week', COUNT(*) FILTER (WHERE deleted_at IS NULL AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' AND status NOT IN ('done','cancelled')),
    'completion_rate', CASE WHEN COUNT(*) FILTER (WHERE deleted_at IS NULL) = 0 THEN 0
      ELSE ROUND((COUNT(*) FILTER (WHERE deleted_at IS NULL AND status='done'))::numeric * 100 / COUNT(*) FILTER (WHERE deleted_at IS NULL), 1) END,
    'archived', COUNT(*) FILTER (WHERE archived_at IS NOT NULL AND deleted_at IS NULL)
  )
  FROM public.tasks
  WHERE organization_id = _org
    AND public.is_org_member(_org, auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.get_tasks_stats(uuid) TO authenticated;

-- Duplicate task RPC
CREATE OR REPLACE FUNCTION public.duplicate_task(_task_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _new uuid; _org uuid;
BEGIN
  SELECT organization_id INTO _org FROM public.tasks WHERE id = _task_id;
  IF _org IS NULL OR NOT public.is_org_member(_org, auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;
  INSERT INTO public.tasks (organization_id, project_id, team_id, department_id, assignee_id, reporter_id,
    title, description, status, priority, start_date, due_date, estimated_hours, labels, progress, position, created_by)
  SELECT organization_id, project_id, team_id, department_id, assignee_id, reporter_id,
    title || ' (Copy)', description, 'todo', priority, start_date, due_date, estimated_hours, labels, 0, position, auth.uid()
  FROM public.tasks WHERE id = _task_id RETURNING id INTO _new;
  RETURN _new;
END; $$;
GRANT EXECUTE ON FUNCTION public.duplicate_task(uuid) TO authenticated;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_checklist;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_attachments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_time_entries;
