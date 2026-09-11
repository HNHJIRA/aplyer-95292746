CREATE OR REPLACE FUNCTION public.record_waitlist_signup(
  _email text,
  _source text DEFAULT NULL,
  _first_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.waitlist_subscribers (email, source)
  VALUES (lower(_email), _source)
  ON CONFLICT (email, source) DO NOTHING;

  INSERT INTO public.waitlist_jobs (kind, email, payload)
  SELECT k, lower(_email),
         jsonb_build_object('firstName', _first_name, 'source', _source)
  FROM unnest(ARRAY['brevo_contact','welcome_email']) AS k
  ON CONFLICT (kind, email) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.record_waitlist_signup(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_waitlist_signup(text, text, text) TO service_role;