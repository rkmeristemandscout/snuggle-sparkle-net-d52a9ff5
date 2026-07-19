-- Add optional department.manage permission and case-insensitive unique index for department names
INSERT INTO public.permissions (key, category, description)
VALUES ('department.manage', 'departments', 'Manage department settings, managers, and lifecycle')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.key = 'department.manage'
  AND r.key IN ('super_admin','organization_owner','admin','manager')
ON CONFLICT DO NOTHING;

-- Case-insensitive unique department name per org (alive rows only)
CREATE UNIQUE INDEX IF NOT EXISTS departments_org_lname_unique_alive
  ON public.departments (organization_id, lower(name))
  WHERE deleted_at IS NULL;
