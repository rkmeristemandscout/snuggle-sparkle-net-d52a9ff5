
-- ============ project_file_shares ============
CREATE TABLE public.project_file_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES public.project_files(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pfs_file ON public.project_file_shares(file_id);
CREATE INDEX idx_pfs_token ON public.project_file_shares(token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_file_shares TO authenticated;
GRANT ALL ON public.project_file_shares TO service_role;

ALTER TABLE public.project_file_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members view file shares" ON public.project_file_shares
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "org members create file shares" ON public.project_file_shares
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(organization_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY "org members update file shares" ON public.project_file_shares
  FOR UPDATE TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "org members delete file shares" ON public.project_file_shares
  FOR DELETE TO authenticated USING (public.is_org_member(organization_id, auth.uid()));

-- ============ discussion_reactions ============
CREATE TABLE public.discussion_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id UUID NOT NULL REFERENCES public.project_discussions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discussion_id, user_id, emoji)
);
CREATE INDEX idx_dreact_disc ON public.discussion_reactions(discussion_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discussion_reactions TO authenticated;
GRANT ALL ON public.discussion_reactions TO service_role;

ALTER TABLE public.discussion_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members view reactions" ON public.discussion_reactions
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id, auth.uid()));
CREATE POLICY "users add own reactions" ON public.discussion_reactions
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() AND public.is_org_member(organization_id, auth.uid())
  );
CREATE POLICY "users delete own reactions" ON public.discussion_reactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.discussion_reactions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.discussion_reactions;
