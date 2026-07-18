
-- Members module extensions

-- 1. Status + department on org members
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='organization_members_status_check') THEN
    ALTER TABLE public.organization_members
      ADD CONSTRAINT organization_members_status_check CHECK (status IN ('active','suspended'));
  END IF;
END $$;

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_organization_members_department ON public.organization_members(department_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_status ON public.organization_members(status);

-- 2. Extra RBAC role on invitations
ALTER TABLE public.organization_invitations
  ADD COLUMN IF NOT EXISTS assigned_role_key text;

-- 3. Extend create_invitation (drop old + recreate with optional _role_key)
DROP FUNCTION IF EXISTS public.create_invitation(uuid, text, public.org_role);

CREATE OR REPLACE FUNCTION public.create_invitation(
  _org uuid,
  _email text,
  _role public.org_role DEFAULT 'member',
  _role_key text DEFAULT NULL
)
RETURNS public.organization_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','auth'
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
  IF _role_key IS NOT NULL AND _role_key NOT IN ('organization_owner','admin','manager','employee','guest') THEN
    RAISE EXCEPTION 'Invalid role assignment';
  END IF;
  IF NOT public.has_org_role(_org, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT u.id INTO _existing_user FROM auth.users u WHERE lower(u.email) = _email_norm LIMIT 1;
  IF _existing_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = _org AND m.user_id = _existing_user
  ) THEN
    RAISE EXCEPTION 'This user is already a member of the organization';
  END IF;

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

  INSERT INTO public.organization_invitations (organization_id, email, role, invited_by, assigned_role_key)
  VALUES (_org, _email_norm, _role, _uid, _role_key)
  RETURNING * INTO _inv;

  RETURN _inv;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invitation(uuid, text, public.org_role, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invitation(uuid, text, public.org_role, text) TO authenticated;

-- 4. Extend accept_invitation to also assign RBAC role_key if set
CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid UUID := auth.uid();
  _email TEXT;
  _inv public.organization_invitations;
  _org public.organizations;
  _role_id UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO _email FROM auth.users WHERE id = _uid;
  SELECT * INTO _inv FROM public.organization_invitations WHERE token = _token LIMIT 1;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF _inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Invitation already used'; END IF;
  IF _inv.rejected_at IS NOT NULL THEN RAISE EXCEPTION 'Invitation was rejected'; END IF;
  IF _inv.expires_at < now() THEN RAISE EXCEPTION 'Invitation expired'; END IF;
  IF lower(_inv.email) <> lower(_email) THEN
    RAISE EXCEPTION 'This invitation is for a different email address';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (_inv.organization_id, _uid, _inv.role)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  IF _inv.assigned_role_key IS NOT NULL THEN
    SELECT id INTO _role_id FROM public.roles WHERE key = _inv.assigned_role_key;
    IF _role_id IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role_id, organization_id, granted_by)
      VALUES (_uid, _role_id, _inv.organization_id, _inv.invited_by)
      ON CONFLICT (user_id, role_id, organization_id) DO NOTHING;
    END IF;
  END IF;

  UPDATE public.organization_invitations SET accepted_at = now() WHERE id = _inv.id;
  SELECT * INTO _org FROM public.organizations WHERE id = _inv.organization_id;
  RETURN _org;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;

-- 5. Enriched member listing RPC (returns last_sign_in_at, teams, department name)
CREATE OR REPLACE FUNCTION public.list_org_members(_org uuid)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  role public.org_role,
  status text,
  created_at timestamptz,
  full_name text,
  email text,
  avatar_url text,
  last_sign_in_at timestamptz,
  department_id uuid,
  department_name text,
  team_names text[]
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public','auth'
AS $$
  SELECT
    m.id, m.user_id, m.role, m.status, m.created_at,
    p.full_name, u.email::text, p.avatar_url,
    u.last_sign_in_at,
    m.department_id, d.name AS department_name,
    COALESCE(
      (SELECT array_agg(t.name ORDER BY t.name)
       FROM public.team_members tm
       JOIN public.teams t ON t.id = tm.team_id
       WHERE tm.user_id = m.user_id AND t.organization_id = _org),
      ARRAY[]::text[]
    ) AS team_names
  FROM public.organization_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN public.departments d ON d.id = m.department_id
  WHERE m.organization_id = _org
    AND public.is_org_member(_org, auth.uid())
  ORDER BY m.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.list_org_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_org_members(uuid) TO authenticated;

-- 6. Suspend/activate helper (owner/admin only)
CREATE OR REPLACE FUNCTION public.set_member_status(_member_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid UUID := auth.uid(); _m public.organization_members;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO _m FROM public.organization_members WHERE id = _member_id;
  IF _m.id IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;
  IF NOT public.has_org_role(_m.organization_id, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  IF _m.user_id = _uid THEN RAISE EXCEPTION 'You cannot change your own status'; END IF;
  UPDATE public.organization_members SET status = _status, updated_at = now() WHERE id = _member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_status(uuid, text) TO authenticated;
