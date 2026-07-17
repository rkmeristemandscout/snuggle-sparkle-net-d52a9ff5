-- Generic CRUD audit trigger function
CREATE OR REPLACE FUNCTION public.audit_crud()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor UUID := auth.uid();
  _org UUID;
  _entity TEXT := TG_TABLE_NAME;
  _action TEXT := lower(TG_OP);
  _row_id TEXT;
  _summary TEXT;
BEGIN
  IF _actor IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  _org := CASE
    WHEN TG_TABLE_NAME = 'organizations' THEN COALESCE((NEW).id, (OLD).id)
    ELSE COALESCE((NEW).organization_id, (OLD).organization_id)
  END;

  _row_id := COALESCE((NEW).id::TEXT, (OLD).id::TEXT);
  _summary := _entity || ' ' || _action;

  BEGIN
    INSERT INTO public.audit_logs (organization_id, actor_id, category, action, entity_type, entity_id, summary, metadata)
    VALUES (
      _org, _actor, 'crud', _entity || '.' || _action, _entity, _row_id, _summary,
      jsonb_build_object(
        'op', TG_OP,
        'new', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
        'old', CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- never block the underlying operation because of audit failure
    NULL;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to core tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','teams','departments','organization_invitations','organization_members']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_crud ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_crud AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_crud()',
      t
    );
  END LOOP;
END $$;

-- Auth event logger (login / logout)
CREATE OR REPLACE FUNCTION public.log_auth_event(_action TEXT, _org UUID DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _action NOT IN ('login','logout') THEN RAISE EXCEPTION 'Invalid auth action'; END IF;
  INSERT INTO public.audit_logs (organization_id, actor_id, category, action, entity_type, entity_id, summary, metadata)
  VALUES (_org, _uid, 'auth', _action, 'user', _uid::TEXT, 'User ' || _action, '{}'::JSONB);
END;
$$;

REVOKE ALL ON FUNCTION public.log_auth_event(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_auth_event(TEXT, UUID) TO authenticated;