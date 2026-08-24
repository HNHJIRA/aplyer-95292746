REVOKE ALL ON public.generated_answers FROM anon, authenticated;
GRANT SELECT ON public.generated_answers TO authenticated;
GRANT ALL ON public.generated_answers TO service_role;
GRANT SELECT ON public.resume_fact_inventories TO authenticated;
GRANT ALL ON public.resume_fact_inventories TO service_role;