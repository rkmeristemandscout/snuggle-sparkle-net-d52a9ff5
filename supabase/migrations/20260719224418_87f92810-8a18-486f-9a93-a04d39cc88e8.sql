-- Add optional department linkage to teams
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS teams_department_id_idx ON public.teams(department_id) WHERE deleted_at IS NULL;