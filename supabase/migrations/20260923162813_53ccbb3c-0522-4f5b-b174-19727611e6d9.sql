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
    IF existing.status IN ('rejected','failed') THEN
      UPDATE public.demo_requests SET idempotency_key = idempotency_key || ':retired:' || id::text
        WHERE id = existing.id;
    ELSE
      RETURN jsonb_build_object('duplicate', true, 'request', to_jsonb(existing));
    END IF;
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
REVOKE ALL ON FUNCTION public.demo_admit(text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_admit(text,text,text,text,text,jsonb) TO service_role;