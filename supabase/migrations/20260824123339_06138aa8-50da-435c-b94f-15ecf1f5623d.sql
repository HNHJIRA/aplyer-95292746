CREATE TABLE IF NOT EXISTS public.question_classifications (
  question_hash TEXT PRIMARY KEY,
  question_text TEXT NOT NULL,
  framework TEXT NOT NULL,
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  reason TEXT,
  model TEXT,
  prompt_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.question_classifications TO service_role;

ALTER TABLE public.question_classifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS question_classifications_created_at_idx
  ON public.question_classifications (created_at DESC);