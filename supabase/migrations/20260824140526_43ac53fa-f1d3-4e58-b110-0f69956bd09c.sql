-- 1. Canonical fact inventory becomes SERVER-WRITE-ONLY.
DROP POLICY IF EXISTS "own fact inventory insert" ON public.resume_fact_inventories;
DROP POLICY IF EXISTS "own fact inventory update" ON public.resume_fact_inventories;
DROP POLICY IF EXISTS "own fact inventory delete" ON public.resume_fact_inventories;
DROP POLICY IF EXISTS "own fact inventory select" ON public.resume_fact_inventories;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.resume_fact_inventories FROM authenticated;
REVOKE ALL ON public.resume_fact_inventories FROM anon;
GRANT SELECT ON public.resume_fact_inventories TO authenticated;
GRANT ALL ON public.resume_fact_inventories TO service_role;

ALTER TABLE public.resume_fact_inventories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own fact inventory select"
  ON public.resume_fact_inventories
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for authenticated: canonical writes happen
-- only through the privileged server-side service-role client.

-- 2. Invalidate inventories produced by the previous (non-SOP) P0 model.
UPDATE public.resume_fact_inventories
SET status = 'stale', updated_at = now()
WHERE status = 'ready' AND model IS DISTINCT FROM 'claude-haiku-4-5';