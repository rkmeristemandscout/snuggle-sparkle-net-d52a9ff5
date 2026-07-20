
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'api_keys') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.api_keys';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'audit_logs') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.audit_logs';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'organization_invitations') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.organization_invitations';
  END IF;
END $$;
