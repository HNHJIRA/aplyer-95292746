CREATE TABLE IF NOT EXISTS public.waitlist_subscribers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_subscribers_email_source_unique UNIQUE (email, source)
);
GRANT ALL ON public.waitlist_subscribers TO service_role;
ALTER TABLE public.waitlist_subscribers ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (server code) can access.