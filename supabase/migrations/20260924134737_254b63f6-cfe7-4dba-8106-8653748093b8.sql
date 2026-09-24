ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS human_score jsonb,
  ADD COLUMN IF NOT EXISTS human_score_status text CHECK (human_score_status IN ('available','unavailable'));
ALTER TABLE public.demo_settings
  ADD COLUMN IF NOT EXISTS human_score_display boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detector_min_words integer CHECK (detector_min_words IS NULL OR detector_min_words > 0),
  ADD COLUMN IF NOT EXISTS detector_length_tolerance numeric CHECK (detector_length_tolerance IS NULL OR detector_length_tolerance >= 0);
UPDATE public.demo_settings SET detector_min_words = 200 WHERE detector_min_words IS NULL;
ALTER TABLE public.demo_cost_events
  ADD COLUMN IF NOT EXISTS duration_ms integer;