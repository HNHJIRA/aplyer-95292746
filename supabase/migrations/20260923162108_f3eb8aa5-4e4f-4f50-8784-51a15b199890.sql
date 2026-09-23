CREATE TABLE public.demo_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  max_runs_per_email integer CHECK (max_runs_per_email IS NULL OR max_runs_per_email >= 0),
  session_limit integer CHECK (session_limit IS NULL OR session_limit >= 0),
  session_window_seconds integer CHECK (session_window_seconds IS NULL OR session_window_seconds > 0),
  ip_limit integer CHECK (ip_limit IS NULL OR ip_limit >= 0),
  ip_window_seconds integer CHECK (ip_window_seconds IS NULL OR ip_window_seconds > 0),
  daily_cap_usd numeric(12,4) CHECK (daily_cap_usd IS NULL OR daily_cap_usd >= 0),
  reset_timezone text,
  reserve_per_demo_usd numeric(12,4) CHECK (reserve_per_demo_usd IS NULL OR reserve_per_demo_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.demo_settings TO service_role;
ALTER TABLE public.demo_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.demo_settings (id) VALUES (true);
CREATE TRIGGER demo_settings_updated BEFORE UPDATE ON public.demo_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.demo_model_pricing (
  provider text NOT NULL,
  model text NOT NULL,
  input_usd_per_mtok numeric(12,6) NOT NULL CHECK (input_usd_per_mtok >= 0),
  output_usd_per_mtok numeric(12,6) NOT NULL CHECK (output_usd_per_mtok >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, model)
);
GRANT ALL ON public.demo_model_pricing TO service_role;
ALTER TABLE public.demo_model_pricing ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.demo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  session_hash text NOT NULL,
  ip_hash text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'admitting'
    CHECK (status IN ('admitting','running','queued','processing','completed','failed','rejected')),
  queue_reason text,
  reject_reason text,
  payload jsonb,
  answer text,
  estimated_cost_usd numeric(12,6),
  cost_status text NOT NULL DEFAULT 'pending' CHECK (cost_status IN ('pending','priced','unpriced')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.demo_requests TO service_role;
ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX demo_requests_email_idx ON public.demo_requests (email);
CREATE INDEX demo_requests_session_idx ON public.demo_requests (session_hash, created_at);
CREATE INDEX demo_requests_ip_idx ON public.demo_requests (ip_hash, created_at);
CREATE INDEX demo_requests_content_idx ON public.demo_requests (email, content_hash);
CREATE INDEX demo_requests_queue_idx ON public.demo_requests (status, next_run_at);
CREATE TRIGGER demo_requests_updated BEFORE UPDATE ON public.demo_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.demo_cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_request_id uuid NOT NULL REFERENCES public.demo_requests(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('openai','aplyer')),
  provider text NOT NULL,
  model text NOT NULL,
  operation text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12,6),
  priced boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.demo_cost_events TO service_role;
ALTER TABLE public.demo_cost_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX demo_cost_events_created_idx ON public.demo_cost_events (created_at);
CREATE INDEX demo_cost_events_request_idx ON public.demo_cost_events (demo_request_id);

-- Spend snapshot for "today" in the configured reset time zone.
CREATE OR REPLACE FUNCTION public.demo_spend_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.demo_settings; day_start timestamptz; spent numeric := 0; unpriced int := 0; inflight int := 0;
BEGIN
  SELECT * INTO s FROM public.demo_settings WHERE id;
  SELECT count(*) INTO inflight FROM public.demo_requests
    WHERE status IN ('admitting','running','processing') AND updated_at > now() - interval '15 minutes';
  IF s.reset_timezone IS NOT NULL THEN
    BEGIN
      day_start := (date_trunc('day', now() AT TIME ZONE s.reset_timezone)) AT TIME ZONE s.reset_timezone;
    EXCEPTION WHEN others THEN day_start := NULL;
    END;
  END IF;
  IF day_start IS NOT NULL THEN
    SELECT coalesce(sum(estimated_cost_usd) FILTER (WHERE priced), 0), count(*) FILTER (WHERE NOT priced)
      INTO spent, unpriced
      FROM public.demo_cost_events WHERE created_at >= day_start;
  END IF;
  RETURN jsonb_build_object(
    'settings', to_jsonb(s),
    'day_start', day_start,
    'next_reset', CASE WHEN day_start IS NULL THEN NULL ELSE day_start + interval '1 day' END,
    'spent_today_usd', spent,
    'unpriced_today', unpriced,
    'inflight', inflight
  );
END; $$;

-- Atomic admission: serialised by an advisory lock so concurrent requests
-- always see each other's rows. Returns the existing row for duplicates.
CREATE OR REPLACE FUNCTION public.demo_admit(
  _email text, _session_hash text, _ip_hash text, _idempotency_key text,
  _content_hash text, _payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing public.demo_requests; new_row public.demo_requests; s public.demo_settings;
  email_total int; session_recent int := 0; ip_recent int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('aplyer_demo_admit'));

  SELECT * INTO existing FROM public.demo_requests WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('duplicate', true, 'request', to_jsonb(existing));
  END IF;

  SELECT * INTO existing FROM public.demo_requests
    WHERE email = _email AND content_hash = _content_hash
      AND status IN ('admitting','running','queued','processing','completed')
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('duplicate', true, 'request', to_jsonb(existing));
  END IF;

  SELECT * INTO s FROM public.demo_settings WHERE id;
  SELECT count(*) INTO email_total FROM public.demo_requests WHERE email = _email AND status <> 'rejected';
  IF s.session_window_seconds IS NOT NULL THEN
    SELECT count(*) INTO session_recent FROM public.demo_requests
      WHERE session_hash = _session_hash AND status <> 'rejected'
        AND created_at > now() - make_interval(secs => s.session_window_seconds);
  END IF;
  IF s.ip_window_seconds IS NOT NULL THEN
    SELECT count(*) INTO ip_recent FROM public.demo_requests
      WHERE ip_hash = _ip_hash AND status <> 'rejected'
        AND created_at > now() - make_interval(secs => s.ip_window_seconds);
  END IF;

  INSERT INTO public.demo_requests (email, session_hash, ip_hash, idempotency_key, content_hash, payload, status)
  VALUES (_email, _session_hash, _ip_hash, _idempotency_key, _content_hash, _payload, 'admitting')
  RETURNING * INTO new_row;

  RETURN jsonb_build_object(
    'duplicate', false,
    'request', to_jsonb(new_row),
    'counts', jsonb_build_object('email_total', email_total, 'session_recent', session_recent, 'ip_recent', ip_recent),
    'spend', public.demo_spend_snapshot()
  );
END; $$;

CREATE OR REPLACE FUNCTION public.claim_demo_requests(_limit integer DEFAULT 5)
RETURNS SETOF public.demo_requests LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.demo_requests r
  SET status = 'processing', locked_at = now(), attempts = r.attempts + 1, updated_at = now()
  WHERE r.id IN (
    SELECT id FROM public.demo_requests
    WHERE status = 'queued' AND next_run_at <= now() AND attempts < max_attempts
    ORDER BY next_run_at LIMIT _limit
    FOR UPDATE SKIP LOCKED
  ) RETURNING r.*;
$$;

CREATE OR REPLACE FUNCTION public.requeue_stale_demo_requests()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (
    UPDATE public.demo_requests SET status = 'queued', locked_at = NULL, updated_at = now()
    WHERE status = 'processing' AND locked_at < now() - interval '10 minutes'
    RETURNING 1
  ) SELECT count(*)::int FROM r;
$$;

REVOKE ALL ON FUNCTION public.demo_spend_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_admit(text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_demo_requests(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.requeue_stale_demo_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_spend_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_admit(text,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_demo_requests(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_demo_requests() TO service_role;