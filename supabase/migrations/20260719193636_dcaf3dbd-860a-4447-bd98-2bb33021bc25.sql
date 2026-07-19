
DROP TRIGGER IF EXISTS projects_audit ON public.projects;
CREATE TRIGGER projects_audit AFTER INSERT OR UPDATE OR DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.audit_crud();

DROP TRIGGER IF EXISTS tasks_audit ON public.tasks;
CREATE TRIGGER tasks_audit AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.audit_crud();

DROP TRIGGER IF EXISTS on_project_created_trg ON public.projects;
CREATE TRIGGER on_project_created_trg AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.on_project_created();

DROP TRIGGER IF EXISTS on_task_assigned_trg ON public.tasks;
CREATE TRIGGER on_task_assigned_trg AFTER INSERT OR UPDATE OF assignee_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.on_task_assigned();

DROP TRIGGER IF EXISTS tasks_mark_completed_trg ON public.tasks;
CREATE TRIGGER tasks_mark_completed_trg BEFORE INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_mark_completed();

DROP TRIGGER IF EXISTS set_updated_at_projects ON public.projects;
CREATE TRIGGER set_updated_at_projects BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_tasks ON public.tasks;
CREATE TRIGGER set_updated_at_tasks BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
