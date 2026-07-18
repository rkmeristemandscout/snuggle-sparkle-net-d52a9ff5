
-- Server-side invitation creation with duplicate + existing-member checks
CREATE OR REPLACE FUNCTION public.create_invitation(_org uuid, _email text, _role public.org_role DEFAULT 'member')
RETURNS public.organization_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _uid UUID := auth.uid();
  _email_norm TEXT := lower(trim(_email));
  _existing_user UUID;
  _inv public.organization_invitations;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _email_norm IS NULL OR _email_norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;
  IF _role NOT IN ('admin','member') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF NOT public.has_org_role(_org, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- Existing active member check (via auth.users email)
  SELECT u.id INTO _existing_user FROM auth.users u WHERE lower(u.email) = _email_norm LIMIT 1;
  IF _existing_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = _org AND m.user_id = _existing_user
  ) THEN
    RAISE EXCEPTION 'This user is already a member of the organization';
  END IF;

  -- Duplicate active invitation check
  IF EXISTS (
    SELECT 1 FROM public.organization_invitations
    WHERE organization_id = _org
      AND lower(email) = _email_norm
      AND accepted_at IS NULL
      AND rejected_at IS NULL
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'An active invitation already exists for this email';
  END IF;

  INSERT INTO public.organization_invitations (organization_id, email, role, invited_by)
  VALUES (_org, _email_norm, _role, _uid)
  RETURNING * INTO _inv;

  RETURN _inv;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invitation(uuid, text, public.org_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invitation(uuid, text, public.org_role) TO authenticated;
