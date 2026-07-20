
CREATE POLICY "task_att_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'task-attachments' AND public.is_org_member((storage.foldername(name))[1]::uuid, auth.uid()));
CREATE POLICY "task_att_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'task-attachments' AND public.is_org_member((storage.foldername(name))[1]::uuid, auth.uid()) AND owner = auth.uid());
CREATE POLICY "task_att_delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'task-attachments' AND (owner = auth.uid() OR public.has_org_role((storage.foldername(name))[1]::uuid, auth.uid(), ARRAY['owner'::org_role,'admin'::org_role])));
