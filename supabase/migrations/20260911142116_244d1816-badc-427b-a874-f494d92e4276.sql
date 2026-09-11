CREATE TABLE IF NOT EXISTS public.waitlist_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('brevo_contact','welcome_email')),
  email text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, email)
);

CREATE INDEX IF NOT EXISTS waitlist_jobs_due_idx
  ON public.waitlist_jobs (status, next_run_at);

GRANT ALL ON public.waitlist_jobs TO service_role;

ALTER TABLE public.waitlist_jobs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS waitlist_jobs_updated ON public.waitlist_jobs;
CREATE TRIGGER waitlist_jobs_updated
  BEFORE UPDATE ON public.waitlist_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Atomically claim due jobs so concurrent workers never double-process one.
CREATE OR REPLACE FUNCTION public.claim_waitlist_jobs(_limit integer DEFAULT 10)
RETURNS SETOF public.waitlist_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.waitlist_jobs j
  SET status = 'processing', locked_at = now(), attempts = j.attempts + 1, updated_at = now()
  WHERE j.id IN (
    SELECT id FROM public.waitlist_jobs
    WHERE status = 'pending' AND next_run_at <= now()
    ORDER BY next_run_at
    LIMIT _limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.claim_waitlist_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_waitlist_jobs(integer) TO service_role;

-- Recover jobs whose worker died mid-flight.
CREATE OR REPLACE FUNCTION public.requeue_stale_waitlist_jobs()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH r AS (
    UPDATE public.waitlist_jobs
    SET status = 'pending', locked_at = NULL, updated_at = now()
    WHERE status = 'processing' AND locked_at < now() - interval '5 minutes'
    RETURNING 1
  ) SELECT count(*)::int FROM r;
$$;

REVOKE ALL ON FUNCTION public.requeue_stale_waitlist_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_stale_waitlist_jobs() TO service_role;