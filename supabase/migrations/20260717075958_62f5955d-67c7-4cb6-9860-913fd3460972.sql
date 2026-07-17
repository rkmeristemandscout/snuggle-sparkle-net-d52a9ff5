-- Prevent duplicate pending invitations for the same email in the same org
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_org_invitation
  ON public.organization_invitations (organization_id, lower(email))
  WHERE accepted_at IS NULL AND rejected_at IS NULL;

-- Enforce email format at the DB layer (immutable regex is safe in CHECK)
ALTER TABLE public.organization_invitations
  DROP CONSTRAINT IF EXISTS organization_invitations_email_format_chk;
ALTER TABLE public.organization_invitations
  ADD CONSTRAINT organization_invitations_email_format_chk
  CHECK (email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$');