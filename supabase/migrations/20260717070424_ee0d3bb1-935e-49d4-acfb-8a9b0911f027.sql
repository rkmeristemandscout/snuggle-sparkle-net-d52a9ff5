
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT email::TEXT FROM auth.users WHERE id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.current_user_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_email() TO authenticated;

DROP POLICY IF EXISTS "Invitees view invitations addressed to them" ON public.organization_invitations;
CREATE POLICY "Invitees view invitations addressed to them"
  ON public.organization_invitations
  FOR SELECT
  TO authenticated
  USING (lower(email) = lower(public.current_user_email()));
