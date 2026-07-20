
-- 1) Move sensitive contact fields (phone, bio) off the org-wide-readable profiles table
CREATE TABLE IF NOT EXISTS public.profile_private (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text,
  bio text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_private TO authenticated;
GRANT ALL ON public.profile_private TO service_role;

ALTER TABLE public.profile_private ENABLE ROW LEVEL SECURITY;

-- Self can read/write own row
CREATE POLICY "profile_private self select" ON public.profile_private
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "profile_private self insert" ON public.profile_private
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profile_private self update" ON public.profile_private
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Org owners/admins of any org the user is in can read (support/admin contact use)
CREATE POLICY "profile_private admins in shared org select" ON public.profile_private
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members me
      JOIN public.organization_members them
        ON them.organization_id = me.organization_id
       AND them.user_id = profile_private.user_id
      WHERE me.user_id = auth.uid()
        AND me.role IN ('owner','admin')
    )
  );

CREATE TRIGGER trg_profile_private_updated
  BEFORE UPDATE ON public.profile_private
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Backfill from existing profiles.phone/bio if present
INSERT INTO public.profile_private (user_id, phone, bio)
SELECT id, phone, bio FROM public.profiles
WHERE phone IS NOT NULL OR bio IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- Drop the now-redundant broadly-readable columns
ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS bio;

-- 2) Tighten task_checklist update/delete: creator, assignee of task, or org admin
DROP POLICY IF EXISTS checklist_update ON public.task_checklist;
DROP POLICY IF EXISTS checklist_delete ON public.task_checklist;

CREATE POLICY checklist_update ON public.task_checklist
  FOR UPDATE TO authenticated
  USING (
    public.is_org_member(organization_id, auth.uid())
    AND (
      created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.assignee_id = auth.uid())
      OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
    )
  )
  WITH CHECK (
    public.is_org_member(organization_id, auth.uid())
    AND (
      created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.assignee_id = auth.uid())
      OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
    )
  );

CREATE POLICY checklist_delete ON public.task_checklist
  FOR DELETE TO authenticated
  USING (
    public.is_org_member(organization_id, auth.uid())
    AND (
      created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.assignee_id = auth.uid())
      OR public.has_org_role(organization_id, auth.uid(), ARRAY['owner','admin']::public.org_role[])
    )
  );

-- 3) Tighten avatars bucket SELECT: only self or users in a shared org
DROP POLICY IF EXISTS "Avatar images readable by authenticated" ON storage.objects;

CREATE POLICY "Avatar images readable by self or shared org"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.shares_org_with(((storage.foldername(name))[1])::uuid)
    )
  );
