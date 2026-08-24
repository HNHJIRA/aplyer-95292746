-- Server-write-only persistence for validated application answers (A -> J pipeline).
CREATE TABLE public.generated_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_id uuid REFERENCES public.resumes(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  question_hash text NOT NULL,
  question_text text NOT NULL,
  framework text NOT NULL,
  mode text NOT NULL DEFAULT 'writedna',
  status text NOT NULL DEFAULT 'generating',
  answer_text text,
  word_count integer,
  fact_ids_used text[] NOT NULL DEFAULT '{}'::text[],
  variants jsonb,
  quality_passed boolean NOT NULL DEFAULT false,
  quality_blocking text[] NOT NULL DEFAULT '{}'::text[],
  revision_count integer NOT NULL DEFAULT 0,
  logical_scan_count integer NOT NULL DEFAULT 0,
  provider_call_count integer NOT NULL DEFAULT 0,
  prompt_i_version text,
  prompt_a_version text,
  prompt_j_version text,
  model_a text,
  model_j text,
  inventory_source_hash text,
  voice_card_source_hash text,
  writedna_version text,
  job_context_hash text,
  generation_id uuid,
  generation_started_at timestamptz,
  generated_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT generated_answers_status_chk CHECK (status IN ('generating','ready','failed')),
  CONSTRAINT generated_answers_mode_chk CHECK (mode IN ('writedna','resume_only_first_choice','resume_only_learned'))
);

CREATE UNIQUE INDEX generated_answers_user_cache_key_uidx
  ON public.generated_answers (user_id, cache_key);
CREATE INDEX generated_answers_user_created_idx
  ON public.generated_answers (user_id, created_at DESC);

-- Authenticated users may READ their own answers only. All writes are made by
-- the privileged server client; the browser can never insert/update/delete.
GRANT SELECT ON public.generated_answers TO authenticated;
GRANT ALL ON public.generated_answers TO service_role;

ALTER TABLE public.generated_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own generated answers select"
  ON public.generated_answers FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER generated_answers_updated
  BEFORE UPDATE ON public.generated_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Resume-only fallback: persist which phrasing the user said sounds like them.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_variant_answer_id uuid,
  ADD COLUMN IF NOT EXISTS preferred_variant_selected_at timestamptz;