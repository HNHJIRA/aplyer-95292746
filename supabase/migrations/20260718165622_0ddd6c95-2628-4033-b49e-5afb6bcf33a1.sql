
-- Add explicit extension onboarding completion + backfill for existing users.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS extension_onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extension_onboarding_completed_at TIMESTAMPTZ;

-- Backfill for users who already legitimately finished the flow.
-- Definition of "finished": has current resume AND (chose resume-only OR completed A/B demo).
UPDATE public.profiles p
SET extension_onboarding_completed = true,
    extension_onboarding_completed_at = COALESCE(p.updated_at, now())
WHERE extension_onboarding_completed = false
  AND EXISTS (SELECT 1 FROM public.resumes r WHERE r.user_id = p.id AND r.is_current = true)
  AND (p.resume_only = true OR p.ab_demo_completed = true);

-- Update handle_new_user to also persist phone from sign-up metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, phone)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'phone'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_settings (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.subscriptions (user_id, tier) VALUES (NEW.id, 'free') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
