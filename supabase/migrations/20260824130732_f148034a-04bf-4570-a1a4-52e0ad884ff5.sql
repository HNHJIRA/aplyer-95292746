CREATE TABLE public.resume_fact_inventories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_id UUID NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  inventory_json JSONB,
  schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT,
  source_hash TEXT NOT NULL,
  generation_id UUID,
  generation_started_at TIMESTAMP WITH TIME ZONE,
  generated_at TIMESTAMP WITH TIME ZONE,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT resume_fact_inventories_status_check
    CHECK (status IN ('pending','extracting','ready','failed','stale')),
  CONSTRAINT resume_fact_inventories_unique_source
    UNIQUE (user_id, resume_id, schema_version, prompt_version)
);

CREATE INDEX idx_resume_fact_inventories_user ON public.resume_fact_inventories(user_id);
CREATE INDEX idx_resume_fact_inventories_resume ON public.resume_fact_inventories(resume_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resume_fact_inventories TO authenticated;
GRANT ALL ON public.resume_fact_inventories TO service_role;

ALTER TABLE public.resume_fact_inventories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own fact inventory select" ON public.resume_fact_inventories
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own fact inventory insert" ON public.resume_fact_inventories
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own fact inventory update" ON public.resume_fact_inventories
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own fact inventory delete" ON public.resume_fact_inventories
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER resume_fact_inventories_updated
  BEFORE UPDATE ON public.resume_fact_inventories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();