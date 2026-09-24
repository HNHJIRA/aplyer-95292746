ALTER TABLE public.demo_settings
  ADD COLUMN scoreboard_threshold numeric CHECK (scoreboard_threshold IS NULL OR scoreboard_threshold >= 0),
  ADD COLUMN scoreboard_references jsonb;
ALTER TABLE public.demo_requests
  ADD COLUMN scoreboard jsonb,
  ADD COLUMN scoreboard_status text CHECK (scoreboard_status IS NULL OR scoreboard_status IN ('shown','suppressed'));