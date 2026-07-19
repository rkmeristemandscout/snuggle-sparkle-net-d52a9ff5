
-- Indexes
DROP INDEX IF EXISTS public.activity_logs_org_idx;
CREATE INDEX IF NOT EXISTS activity_logs_org_action_idx
  ON public.activity_logs (organization_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_org_actor_idx
  ON public.activity_logs (organization_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_org_entity_idx
  ON public.activity_logs (organization_id, entity_type, created_at DESC);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS activity_logs_summary_trgm_idx
  ON public.activity_logs USING gin (summary gin_trgm_ops);

-- Safe writer
CREATE OR REPLACE FUNCTION public.log_activity_safe(
  _org uuid, _actor uuid, _action text, _entity_type text,
  _entity_id uuid, _summary text, _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _org IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.activity_logs (organization_id, actor_id, action, entity_type, entity_id, summary, metadata)
    VALUES (_org, _actor, _action, _entity_type, _entity_id, _summary, COALESCE(_metadata, '{}'::jsonb));
  EXCEPTION WHEN OTHERS THEN NULL; END;
END; $$;

-- Wrap existing triggers
CREATE OR REPLACE FUNCTION public.on_member_joined()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _actor UUID := auth.uid(); _org_name TEXT; _member_name TEXT;
BEGIN
  BEGIN
    SELECT name INTO _org_name FROM public.organizations WHERE id = NEW.organization_id;
    SELECT COALESCE(full_name, 'A new member') INTO _member_name FROM public.profiles WHERE id = NEW.user_id;
    PERFORM public.log_activity_safe(NEW.organization_id, _actor, 'member.joined', 'organization_member', NEW.id,
      _member_name || ' joined ' || COALESCE(_org_name, 'the organization'),
      jsonb_build_object('user_id', NEW.user_id, 'role', NEW.role));
    PERFORM public.notify_org_members(NEW.organization_id, NEW.user_id, 'member.joined',
      'New member joined', _member_name || ' joined the organization', '/organizations',
      jsonb_build_object('user_id', NEW.user_id));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.on_team_created()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _actor UUID := auth.uid(); _actor_name TEXT;
BEGIN
  BEGIN
    SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = _actor;
    PERFORM public.log_activity_safe(NEW.organization_id, _actor, 'team.created', 'team', NEW.id,
      _actor_name || ' created team ' || NEW.name, jsonb_build_object('team_name', NEW.name, 'slug', NEW.slug));
    PERFORM public.notify_org_members(NEW.organization_id, _actor, 'team.created', 'New team created',
      _actor_name || ' created team ' || NEW.name, '/teams', jsonb_build_object('team_id', NEW.id));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.on_project_created()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _actor UUID := auth.uid(); _actor_name TEXT;
BEGIN
  BEGIN
    SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = _actor;
    PERFORM public.log_activity_safe(NEW.organization_id, _actor, 'project.created', 'project', NEW.id,
      _actor_name || ' created project ' || NEW.name, jsonb_build_object('project_name', NEW.name));
    PERFORM public.notify_org_members(NEW.organization_id, _actor, 'project.created', 'New project created',
      _actor_name || ' created project ' || NEW.name, '/projects', jsonb_build_object('project_id', NEW.id));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.on_member_role_updated()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _actor UUID := auth.uid(); _member_name TEXT; _org_name TEXT;
BEGIN
  IF NEW.role = OLD.role THEN RETURN NEW; END IF;
  BEGIN
    SELECT COALESCE(full_name, 'A member') INTO _member_name FROM public.profiles WHERE id = NEW.user_id;
    SELECT name INTO _org_name FROM public.organizations WHERE id = NEW.organization_id;
    PERFORM public.log_activity_safe(NEW.organization_id, _actor, 'member.role_updated', 'organization_member', NEW.id,
      _member_name || ' is now ' || NEW.role,
      jsonb_build_object('user_id', NEW.user_id, 'from', OLD.role, 'to', NEW.role));
    INSERT INTO public.notifications (user_id, organization_id, type, title, message, link, metadata)
    VALUES (NEW.user_id, NEW.organization_id, 'role.updated', 'Your role changed',
      'Your role in ' || COALESCE(_org_name, 'the organization') || ' is now ' || NEW.role,
      '/dashboard', jsonb_build_object('from', OLD.role, 'to', NEW.role));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END; $function$;

-- New triggers
CREATE OR REPLACE FUNCTION public.on_organization_created_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor_name TEXT;
BEGIN
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = NEW.created_by;
  PERFORM public.log_activity_safe(NEW.id, NEW.created_by, 'organization.created', 'organization', NEW.id,
    _actor_name || ' created organization ' || NEW.name, jsonb_build_object('slug', NEW.slug));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_organization_created_activity ON public.organizations;
CREATE TRIGGER trg_on_organization_created_activity
AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.on_organization_created_activity();

CREATE OR REPLACE FUNCTION public.on_department_created_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor UUID := auth.uid(); _actor_name TEXT;
BEGIN
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = COALESCE(_actor, NEW.created_by);
  PERFORM public.log_activity_safe(NEW.organization_id, COALESCE(_actor, NEW.created_by),
    'department.created', 'department', NEW.id,
    _actor_name || ' created department ' || NEW.name, jsonb_build_object('slug', NEW.slug));
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_department_created_activity ON public.departments;
CREATE TRIGGER trg_on_department_created_activity
AFTER INSERT ON public.departments FOR EACH ROW EXECUTE FUNCTION public.on_department_created_activity();

CREATE OR REPLACE FUNCTION public.on_invitation_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor UUID := auth.uid(); _actor_name TEXT;
BEGIN
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = _actor;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity_safe(NEW.organization_id, COALESCE(_actor, NEW.invited_by),
      'invitation.sent', 'organization_invitation', NEW.id,
      COALESCE(_actor_name, 'Someone') || ' invited ' || NEW.email,
      jsonb_build_object('email', NEW.email, 'role', NEW.role));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN
      PERFORM public.log_activity_safe(NEW.organization_id, _actor,
        'invitation.accepted', 'organization_invitation', NEW.id,
        NEW.email || ' accepted the invitation', jsonb_build_object('email', NEW.email));
    ELSIF NEW.rejected_at IS NOT NULL AND OLD.rejected_at IS NULL THEN
      PERFORM public.log_activity_safe(NEW.organization_id, _actor,
        'invitation.rejected', 'organization_invitation', NEW.id,
        NEW.email || ' rejected the invitation', jsonb_build_object('email', NEW.email));
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_invitation_activity ON public.organization_invitations;
CREATE TRIGGER trg_on_invitation_activity
AFTER INSERT OR UPDATE ON public.organization_invitations
FOR EACH ROW EXECUTE FUNCTION public.on_invitation_activity();

CREATE OR REPLACE FUNCTION public.on_api_key_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _actor UUID := auth.uid(); _actor_name TEXT;
BEGIN
  SELECT COALESCE(full_name, 'Someone') INTO _actor_name FROM public.profiles WHERE id = _actor;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity_safe(NEW.organization_id, COALESCE(_actor, NEW.created_by),
      'api_key.created', 'api_key', NEW.id,
      COALESCE(_actor_name, 'Someone') || ' created API key ' || NEW.name,
      jsonb_build_object('prefix', NEW.prefix, 'name', NEW.name));
  ELSIF TG_OP = 'UPDATE' AND NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    PERFORM public.log_activity_safe(NEW.organization_id, _actor,
      'api_key.revoked', 'api_key', NEW.id,
      COALESCE(_actor_name, 'Someone') || ' revoked API key ' || NEW.name,
      jsonb_build_object('prefix', NEW.prefix, 'name', NEW.name));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_api_key_activity ON public.api_keys;
CREATE TRIGGER trg_on_api_key_activity
AFTER INSERT OR UPDATE ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.on_api_key_activity();

CREATE OR REPLACE FUNCTION public.on_subscription_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _plan TEXT;
BEGIN
  SELECT key INTO _plan FROM public.plans WHERE id = NEW.plan_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_activity_safe(NEW.organization_id, auth.uid(),
      'billing.updated', 'subscription', NEW.id,
      'Subscription started on plan ' || COALESCE(_plan, 'unknown'),
      jsonb_build_object('status', NEW.status, 'plan', _plan));
  ELSIF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
        OR NEW.cancel_at_period_end IS DISTINCT FROM OLD.cancel_at_period_end) THEN
    PERFORM public.log_activity_safe(NEW.organization_id, auth.uid(),
      'billing.updated', 'subscription', NEW.id,
      'Subscription updated (' || NEW.status || ')',
      jsonb_build_object('status', NEW.status, 'plan', _plan,
        'cancel_at_period_end', NEW.cancel_at_period_end));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_subscription_activity ON public.subscriptions;
CREATE TRIGGER trg_on_subscription_activity
AFTER INSERT OR UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.on_subscription_activity();

CREATE OR REPLACE FUNCTION public.on_profile_updated_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org_id UUID; _actor_name TEXT;
BEGIN
  IF NEW.full_name IS NOT DISTINCT FROM OLD.full_name
     AND NEW.avatar_url IS NOT DISTINCT FROM OLD.avatar_url THEN
    RETURN NEW;
  END IF;
  _actor_name := COALESCE(NEW.full_name, 'A member');
  FOR _org_id IN SELECT organization_id FROM public.organization_members WHERE user_id = NEW.id LOOP
    PERFORM public.log_activity_safe(_org_id, NEW.id, 'profile.updated', 'profile', NEW.id,
      _actor_name || ' updated their profile', '{}'::jsonb);
  END LOOP;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_on_profile_updated_activity ON public.profiles;
CREATE TRIGGER trg_on_profile_updated_activity
AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.on_profile_updated_activity();

-- Retention
CREATE OR REPLACE FUNCTION public.cleanup_old_activity_logs(_days integer DEFAULT 365)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n INT;
BEGIN
  WITH del AS (
    DELETE FROM public.activity_logs WHERE created_at < now() - (_days || ' days')::INTERVAL
    RETURNING 1
  ) SELECT count(*) INTO _n FROM del;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public.run_background_jobs()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _inv INT; _notif INT; _audit INT; _err INT; _act INT;
BEGIN
  _inv   := public.cleanup_expired_invitations();
  _notif := public.cleanup_old_notifications(60);
  _audit := public.cleanup_old_audit_logs(365);
  _err   := public.cleanup_old_error_logs(30);
  _act   := public.cleanup_old_activity_logs(365);
  RETURN jsonb_build_object(
    'expired_invitations', _inv, 'old_notifications', _notif,
    'old_audit_logs', _audit, 'old_error_logs', _err,
    'old_activity_logs', _act, 'ran_at', now()
  );
END; $function$;

-- RBAC
INSERT INTO public.permissions (key, category, description)
VALUES ('activity.view', 'activity', 'View the workspace activity stream')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.key = 'activity.view'
  AND r.key IN ('organization_owner','admin','manager','employee')
ON CONFLICT DO NOTHING;
