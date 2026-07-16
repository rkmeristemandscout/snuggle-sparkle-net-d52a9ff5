
-- ============================================================
-- Enums
-- ============================================================
CREATE TYPE public.team_role AS ENUM ('owner', 'member');

-- ============================================================
-- Teams
-- ============================================================
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
CREATE INDEX idx_teams_org ON public.teams(organization_id);
CREATE INDEX idx_teams_owner ON public.teams(owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_teams_updated
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Team members
-- ============================================================
CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.team_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX idx_team_members_team ON public.team_members(team_id);
CREATE INDEX idx_team_members_user ON public.team_members(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_team_members_updated
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Helper functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.team_org(_team UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT organization_id FROM public.teams WHERE id = _team $$;

CREATE OR REPLACE FUNCTION public.is_team_member(_team UUID, _user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = _team AND user_id = _user
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_team(_team UUID, _user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = _team
      AND (
        t.owner_id = _user
        OR public.has_org_role(t.organization_id, _user, ARRAY['owner','admin']::public.org_role[])
      )
  );
$$;

REVOKE ALL ON FUNCTION public.team_org(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_team_member(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_team(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_org(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_team_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_team(UUID, UUID) TO authenticated;

-- ============================================================
-- Team RLS
-- ============================================================
CREATE POLICY "Org members view teams"
  ON public.teams FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "Org owners/admins create teams"
  ON public.teams FOR INSERT TO authenticated
  WITH CHECK (
    public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
    AND created_by = auth.uid()
  );

CREATE POLICY "Team owners or org admins update teams"
  ON public.teams FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
  );

CREATE POLICY "Team owners or org admins delete teams"
  ON public.teams FOR DELETE TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
  );

-- ============================================================
-- Team members RLS
-- ============================================================
CREATE POLICY "Org members view team members"
  ON public.team_members FOR SELECT TO authenticated
  USING (public.is_org_member(public.team_org(team_id), auth.uid()));

CREATE POLICY "Team managers add members"
  ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_team(team_id, auth.uid()));

CREATE POLICY "Team managers update members"
  ON public.team_members FOR UPDATE TO authenticated
  USING (public.can_manage_team(team_id, auth.uid()))
  WITH CHECK (public.can_manage_team(team_id, auth.uid()));

CREATE POLICY "Team managers remove members, users can leave"
  ON public.team_members FOR DELETE TO authenticated
  USING (
    public.can_manage_team(team_id, auth.uid())
    OR user_id = auth.uid()
  );

-- ============================================================
-- Auto-add team owner as member
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_team_owner_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'owner';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_add_team_owner
  AFTER INSERT ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.add_team_owner_as_member();

CREATE OR REPLACE FUNCTION public.sync_team_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id <> OLD.owner_id THEN
    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (NEW.id, NEW.owner_id, 'owner')
    ON CONFLICT (team_id, user_id) DO UPDATE SET role = 'owner';
    UPDATE public.team_members SET role = 'member'
      WHERE team_id = NEW.id AND user_id = OLD.owner_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_team_owner
  AFTER UPDATE OF owner_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_owner_membership();

-- ============================================================
-- Departments
-- ============================================================
CREATE TABLE public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
CREATE INDEX idx_departments_org ON public.departments(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_departments_updated
  BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Org members view departments"
  ON public.departments FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "Org owners/admins create departments"
  ON public.departments FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));

CREATE POLICY "Org owners/admins update departments"
  ON public.departments FOR UPDATE TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]))
  WITH CHECK (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));

CREATE POLICY "Org owners/admins delete departments"
  ON public.departments FOR DELETE TO authenticated
  USING (public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[]));

-- ============================================================
-- Seed default departments per new organization
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_default_departments()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.departments (organization_id, name, slug, created_by) VALUES
    (NEW.id, 'HR',          'hr',          NEW.created_by),
    (NEW.id, 'Sales',       'sales',       NEW.created_by),
    (NEW.id, 'Marketing',   'marketing',   NEW.created_by),
    (NEW.id, 'Engineering', 'engineering', NEW.created_by),
    (NEW.id, 'Finance',     'finance',     NEW.created_by);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_departments
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_departments();

-- Backfill existing organizations
INSERT INTO public.departments (organization_id, name, slug)
SELECT o.id, d.name, d.slug FROM public.organizations o
CROSS JOIN (VALUES
  ('HR','hr'),('Sales','sales'),('Marketing','marketing'),
  ('Engineering','engineering'),('Finance','finance')
) AS d(name, slug)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ============================================================
-- Invitations lifecycle enhancements
-- ============================================================
ALTER TABLE public.organization_invitations
  ADD COLUMN rejected_at TIMESTAMPTZ;

-- Reject invitation (invitee)
CREATE OR REPLACE FUNCTION public.reject_invitation(_token TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _email TEXT;
  _inv public.organization_invitations;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO _email FROM auth.users WHERE id = _uid;
  SELECT * INTO _inv FROM public.organization_invitations WHERE token = _token LIMIT 1;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF _inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Invitation already accepted'; END IF;
  IF lower(_inv.email) <> lower(_email) THEN
    RAISE EXCEPTION 'This invitation is for a different email address';
  END IF;
  UPDATE public.organization_invitations SET rejected_at = now() WHERE id = _inv.id;
END;
$$;

-- Resend: regenerate token + extend expiry (admin/owner only)
CREATE OR REPLACE FUNCTION public.resend_invitation(_invitation_id UUID)
RETURNS public.organization_invitations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _inv public.organization_invitations;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _inv FROM public.organization_invitations WHERE id = _invitation_id;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF NOT public.has_org_role(_inv.organization_id, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  IF _inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Invitation already accepted'; END IF;

  UPDATE public.organization_invitations
     SET token = encode(gen_random_bytes(24), 'hex'),
         expires_at = now() + INTERVAL '14 days',
         rejected_at = NULL,
         updated_at = now()
   WHERE id = _invitation_id
   RETURNING * INTO _inv;
  RETURN _inv;
END;
$$;

-- Expire immediately (admin/owner only)
CREATE OR REPLACE FUNCTION public.expire_invitation(_invitation_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _inv public.organization_invitations;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _inv FROM public.organization_invitations WHERE id = _invitation_id;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF NOT public.has_org_role(_inv.organization_id, _uid, ARRAY['owner','admin']::public.org_role[]) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  UPDATE public.organization_invitations SET expires_at = now() WHERE id = _invitation_id;
END;
$$;

-- Update accept_invitation to consider rejection
CREATE OR REPLACE FUNCTION public.accept_invitation(_token TEXT)
RETURNS public.organizations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _email TEXT;
  _inv public.organization_invitations;
  _org public.organizations;
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

  UPDATE public.organization_invitations SET accepted_at = now() WHERE id = _inv.id;
  SELECT * INTO _org FROM public.organizations WHERE id = _inv.organization_id;
  RETURN _org;
END;
$$;

-- Public lookup for the invitee: allow an authenticated user to read
-- their own invitation by matching email (needed for /join/$token UI).
CREATE POLICY "Invitees view invitations addressed to them"
  ON public.organization_invitations FOR SELECT TO authenticated
  USING (lower(email) = lower((SELECT u.email FROM auth.users u WHERE u.id = auth.uid())));

REVOKE ALL ON FUNCTION public.reject_invitation(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resend_invitation(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expire_invitation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resend_invitation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_invitation(UUID) TO authenticated;
