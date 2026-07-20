
-- Enable realtime on tasks for Kanban board
ALTER TABLE public.tasks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;

-- Trigger to create notifications when a user is mentioned in a task comment.
-- Mention syntax: @[Display Name](uuid)
CREATE OR REPLACE FUNCTION public.notify_task_comment_mentions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mentioned_id uuid;
  task_title text;
  author_name text;
BEGIN
  SELECT title INTO task_title FROM public.tasks WHERE id = NEW.task_id;
  SELECT COALESCE(full_name, 'Someone') INTO author_name FROM public.profiles WHERE id = NEW.author_id;

  FOR mentioned_id IN
    SELECT DISTINCT (regexp_matches(NEW.content, '@\[[^\]]+\]\(([0-9a-fA-F-]{36})\)', 'g'))[1]::uuid
  LOOP
    IF mentioned_id = NEW.author_id THEN
      CONTINUE;
    END IF;
    -- ensure mentioned user is a member of the same organization
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = NEW.organization_id AND user_id = mentioned_id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, organization_id, type, title, message, link, metadata)
    VALUES (
      mentioned_id,
      NEW.organization_id,
      'task.mention',
      author_name || ' mentioned you',
      left(regexp_replace(NEW.content, '@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)', '@\1', 'g'), 240),
      '/tasks/' || NEW.task_id::text,
      jsonb_build_object('task_id', NEW.task_id, 'comment_id', NEW.id, 'author_id', NEW.author_id, 'task_title', task_title)
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_comment_mentions ON public.task_comments;
CREATE TRIGGER trg_task_comment_mentions
AFTER INSERT ON public.task_comments
FOR EACH ROW EXECUTE FUNCTION public.notify_task_comment_mentions();
