-- Part D: weekly per-email allowance (Sept 23 spec: "The allowance resets seven
-- days after the first run, per address."). Not a rolling window, not a calendar
-- week. Only change vs previous demo_admit: email_total now counts counted rows
-- (status <> 'rejected') in the CURRENT allowance period, derived from created_at
-- history. Lock, same-key idempotency, content rule, session/IP counters unchanged.
CREATE OR REPLACE FUNCTION public.demo_admit(
  _email text, _session_hash text, _ip_hash text, _idempotency_key text,
  _content_hash text, _payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing public.demo_requests; new_row public.demo_requests; s public.demo_settings;
  email_total int := 0; session_recent int := 0; ip_recent int := 0;
  period_anchor timestamptz := NULL; period_count int := 0; r record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('aplyer_demo_admit'));

  -- Same submission key: same submission (double press / stream fallback).
  SELECT * INTO existing FROM public.demo_requests WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF existing.status IN ('rejected','failed') THEN
      UPDATE public.demo_requests SET idempotency_key = idempotency_key || ':retired:' || id::text
        WHERE id = existing.id;
    ELSE
      RETURN jsonb_build_object('duplicate', true, 'request', to_jsonb(existing));
    END IF;
  END IF;

  -- Identical content from a different key: attach ONLY to work still pending
  -- or in progress (prevents duplicate paid runs). Completed rows are never reused.
  SELECT * INTO existing FROM public.demo_requests
    WHERE email = _email AND content_hash = _content_hash
      AND status IN ('admitting','running','queued','processing')
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('duplicate', true, 'request', to_jsonb(existing));
  END IF;

  SELECT * INTO s FROM public.demo_settings WHERE id;

  -- Allowance periods: walk counted runs in submission order. A run at or after
  -- anchor + 7 days starts a new period anchored at that run.
  FOR r IN SELECT created_at FROM public.demo_requests
      WHERE email = _email AND status <> 'rejected' ORDER BY created_at, id LOOP
    IF period_anchor IS NULL OR r.created_at >= period_anchor + interval '7 days' THEN
      period_anchor := r.created_at; period_count := 1;
    ELSE
      period_count := period_count + 1;
    END IF;
  END LOOP;
  IF period_anchor IS NOT NULL AND now() < period_anchor + interval '7 days' THEN
    email_total := period_count;
  END IF;

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