CREATE TABLE IF NOT EXISTS public.welcome_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  first_name text,
  source text,
  status text NOT NULL DEFAULT 'attempted',
  provider text NOT NULL DEFAULT 'brevo',
  provider_message_id text,
  error_code text,
  attempts integer NOT NULL DEFAULT 0,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.welcome_email_events TO service_role;

ALTER TABLE public.welcome_email_events ENABLE ROW LEVEL SECURITY;
