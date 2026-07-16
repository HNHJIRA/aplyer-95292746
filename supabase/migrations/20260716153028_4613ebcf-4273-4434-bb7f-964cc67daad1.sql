
-- 1. Columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS resume_uploaded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS writing_sample_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_confidence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resume_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_card_status TEXT NOT NULL DEFAULT 'locked',
  ADD COLUMN IF NOT EXISTS celebrated_strong BOOLEAN NOT NULL DEFAULT false;

-- constrain enum values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_voice_card_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_voice_card_status_check
      CHECK (voice_card_status IN ('locked','unlocking','unlocked'));
  END IF;
END$$;

-- 2. Recalculation function
CREATE OR REPLACE FUNCTION public.recalc_writedna(_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_resume BOOLEAN;
  sample_count INTEGER;
  confidence INTEGER;
  card_status TEXT;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.resumes
    WHERE user_id = _user_id AND is_current = true
  ) INTO has_resume;

  SELECT COUNT(*) INTO sample_count
  FROM public.writing_samples
  WHERE user_id = _user_id
    AND char_length(coalesce(content, '')) >= 100
    AND word_count >= 30
    AND type IN (
      'cover_letter','linkedin_post','professional_email',
      'blog','essay','free_text','career_summary','other'
    );

  IF NOT has_resume THEN
    confidence := 0;
    card_status := 'locked';
  ELSIF sample_count = 0 THEN
    confidence := 35;
    card_status := 'locked';
  ELSIF sample_count = 1 THEN
    confidence := 70;
    card_status := 'unlocking';
  ELSE
    confidence := 100;
    card_status := 'unlocked';
  END IF;

  UPDATE public.profiles
  SET
    resume_uploaded = has_resume,
    writing_sample_count = sample_count,
    voice_confidence = confidence,
    voice_card_status = card_status,
    resume_only = CASE WHEN sample_count > 0 THEN false ELSE resume_only END,
    updated_at = now()
  WHERE id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalc_writedna(UUID) TO authenticated, service_role;

-- 3. Trigger function
CREATE OR REPLACE FUNCTION public.trg_recalc_writedna()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    uid := OLD.user_id;
  ELSE
    uid := NEW.user_id;
  END IF;
  PERFORM public.recalc_writedna(uid);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_writedna_on_resumes ON public.resumes;
CREATE TRIGGER trg_writedna_on_resumes
AFTER INSERT OR UPDATE OR DELETE ON public.resumes
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_writedna();

DROP TRIGGER IF EXISTS trg_writedna_on_samples ON public.writing_samples;
CREATE TRIGGER trg_writedna_on_samples
AFTER INSERT OR UPDATE OR DELETE ON public.writing_samples
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_writedna();

-- 4. Backfill existing users
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles LOOP
    PERFORM public.recalc_writedna(r.id);
  END LOOP;
END$$;
