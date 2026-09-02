ALTER TABLE public.generated_answers ADD COLUMN IF NOT EXISTS answer_rule_audit JSONB;

CREATE TABLE public.application_field_answers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_hash TEXT NOT NULL,
  normalized_question TEXT NOT NULL,
  question_text TEXT NOT NULL,
  field_type TEXT NOT NULL,
  answer_value TEXT NOT NULL,
  options_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'user',
  confidence TEXT NOT NULL DEFAULT 'HIGH',
  confirmed_by_user BOOLEAN NOT NULL DEFAULT true,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT application_field_answers_user_question_unique UNIQUE (user_id, question_hash, field_type)
);

GRANT SELECT ON public.application_field_answers TO authenticated;
GRANT ALL ON public.application_field_answers TO service_role;

ALTER TABLE public.application_field_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own field answers select"
  ON public.application_field_answers
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX application_field_answers_user_idx
  ON public.application_field_answers (user_id, updated_at DESC);

CREATE TRIGGER application_field_answers_updated
  BEFORE UPDATE ON public.application_field_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();