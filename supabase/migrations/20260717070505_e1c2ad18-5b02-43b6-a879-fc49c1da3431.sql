
CREATE OR REPLACE FUNCTION public.mark_org_deleting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.deleting_org', OLD.id::text, true);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_org_deleting ON public.organizations;
CREATE TRIGGER trg_mark_org_deleting
  BEFORE DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.mark_org_deleting();

CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner_count INT;
  _deleting TEXT;
BEGIN
  _deleting := current_setting('app.deleting_org', true);
  IF _deleting IS NOT NULL AND _deleting = COALESCE(NEW.organization_id, OLD.organization_id)::text THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' AND OLD.role = 'owner' THEN
    SELECT count(*) INTO _owner_count FROM public.organization_members
      WHERE organization_id = OLD.organization_id AND role = 'owner';
    IF _owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last owner of the organization';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner' THEN
    SELECT count(*) INTO _owner_count FROM public.organization_members
      WHERE organization_id = OLD.organization_id AND role = 'owner';
    IF _owner_count <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the last owner of the organization';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
