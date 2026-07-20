
-- Project Files
CREATE TABLE public.project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_files TO authenticated;
GRANT ALL ON public.project_files TO service_role;
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_files_select" ON public.project_files FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "project_files_insert" ON public.project_files FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id, auth.uid()) AND uploaded_by = auth.uid());
CREATE POLICY "project_files_delete" ON public.project_files FOR DELETE TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()) AND (uploaded_by = auth.uid()
    OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])));

CREATE INDEX idx_project_files_project ON public.project_files(project_id, created_at DESC);

-- Project Discussions
CREATE TABLE public.project_discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.project_discussions(id) ON DELETE CASCADE,
  title text,
  body text NOT NULL,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_discussions TO authenticated;
GRANT ALL ON public.project_discussions TO service_role;
ALTER TABLE public.project_discussions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_disc_select" ON public.project_discussions FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "project_disc_insert" ON public.project_discussions FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(organization_id, auth.uid()) AND author_id = auth.uid());
CREATE POLICY "project_disc_update" ON public.project_discussions FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "project_disc_delete" ON public.project_discussions FOR DELETE TO authenticated
  USING (author_id = auth.uid()
    OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));

CREATE INDEX idx_project_disc_project ON public.project_discussions(project_id, created_at DESC);
CREATE INDEX idx_project_disc_parent ON public.project_discussions(parent_id);

CREATE TRIGGER trg_project_disc_updated
  BEFORE UPDATE ON public.project_discussions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Activity trigger for discussions
CREATE OR REPLACE FUNCTION public.on_project_discussion_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _actor uuid := auth.uid(); _actor_name text; _kind text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(full_name,'Someone') INTO _actor_name FROM public.profiles WHERE id = _actor;
    _kind := CASE WHEN NEW.parent_id IS NULL THEN 'project.discussion.created' ELSE 'project.discussion.replied' END;
    PERFORM public.log_activity_safe(NEW.organization_id, _actor, _kind, 'project', NEW.project_id,
      COALESCE(_actor_name,'Someone') || CASE WHEN NEW.parent_id IS NULL THEN ' started a discussion' ELSE ' replied in a discussion' END,
      jsonb_build_object('discussion_id', NEW.id, 'parent_id', NEW.parent_id, 'title', NEW.title));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_project_disc_activity
  AFTER INSERT ON public.project_discussions
  FOR EACH ROW EXECUTE FUNCTION public.on_project_discussion_activity();

-- Activity trigger for files
CREATE OR REPLACE FUNCTION public.on_project_file_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _actor uuid := auth.uid(); _actor_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(full_name,'Someone') INTO _actor_name FROM public.profiles WHERE id = _actor;
    PERFORM public.log_activity_safe(NEW.organization_id, _actor, 'project.file.uploaded', 'project', NEW.project_id,
      COALESCE(_actor_name,'Someone') || ' uploaded ' || NEW.file_name,
      jsonb_build_object('file_id', NEW.id, 'file_name', NEW.file_name, 'size', NEW.file_size));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_activity_safe(OLD.organization_id, _actor, 'project.file.deleted', 'project', OLD.project_id,
      'File ' || OLD.file_name || ' was deleted',
      jsonb_build_object('file_id', OLD.id, 'file_name', OLD.file_name));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_project_file_activity
  AFTER INSERT OR DELETE ON public.project_files
  FOR EACH ROW EXECUTE FUNCTION public.on_project_file_activity();

-- Storage RLS for project-files bucket: path = {organization_id}/{project_id}/...
CREATE POLICY "project_files_storage_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-files' AND public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid()));
CREATE POLICY "project_files_storage_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-files' AND public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid()));
CREATE POLICY "project_files_storage_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-files' AND public.is_org_member(((storage.foldername(name))[1])::uuid, auth.uid()));
