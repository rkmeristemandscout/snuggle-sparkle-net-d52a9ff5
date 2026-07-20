
-- 1. Comment-scoped attachments on task_comments
ALTER TABLE public.task_attachments
  ADD COLUMN IF NOT EXISTS comment_id uuid REFERENCES public.task_comments(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS task_attachments_comment_idx ON public.task_attachments (comment_id);

-- 2. Notify discussion authors when someone reacts to their discussion / reply
CREATE OR REPLACE FUNCTION public.notify_discussion_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d record;
  reactor_name text;
BEGIN
  SELECT id, project_id, author_id, COALESCE(title, LEFT(body, 60)) AS label
    INTO d
    FROM public.project_discussions
    WHERE id = NEW.discussion_id;

  IF d.author_id IS NULL OR d.author_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, 'Someone') INTO reactor_name
    FROM public.profiles WHERE id = NEW.user_id;

  INSERT INTO public.notifications (user_id, organization_id, type, title, message, link, metadata)
  VALUES (
    d.author_id,
    NEW.organization_id,
    'discussion.reaction',
    COALESCE(reactor_name, 'Someone') || ' reacted ' || NEW.emoji,
    'On your discussion: ' || COALESCE(d.label, ''),
    '/projects/' || d.project_id,
    jsonb_build_object(
      'discussion_id', d.id,
      'emoji', NEW.emoji,
      'reactor_id', NEW.user_id,
      'project_id', d.project_id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_discussion_reaction ON public.discussion_reactions;
CREATE TRIGGER trg_notify_discussion_reaction
AFTER INSERT ON public.discussion_reactions
FOR EACH ROW EXECUTE FUNCTION public.notify_discussion_reaction();
