
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.prose_content_hash(_content TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT encode(extensions.digest(regexp_replace(lower(trim(coalesce(_content, ''))), '\s+', ' ', 'g'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.is_qualifying_prose(_content TEXT, _type TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE trimmed TEXT; word_ct INT; total_lines INT; bullet_lines INT;
BEGIN
  IF _content IS NULL THEN RETURN false; END IF;
  trimmed := trim(_content);
  IF char_length(trimmed) < 100 THEN RETURN false; END IF;
  IF _type IS NULL OR _type NOT IN ('cover_letter','linkedin_post','professional_email','blog','essay','free_text','career_summary','other') THEN RETURN false; END IF;
  word_ct := array_length(regexp_split_to_array(trimmed, '\s+'), 1);
  IF word_ct IS NULL OR word_ct < 30 THEN RETURN false; END IF;
  SELECT count(*) FILTER (WHERE length(btrim(l)) > 0),
         count(*) FILTER (WHERE length(btrim(l)) > 0 AND btrim(l) ~ '^(\-|\*|•|\d+\.)\s')
  INTO total_lines, bullet_lines
  FROM regexp_split_to_table(trimmed, E'\n') AS l;
  IF total_lines >= 3 AND bullet_lines::NUMERIC / total_lines::NUMERIC > 0.6 THEN RETURN false; END IF;
  RETURN true;
END; $$;

ALTER TABLE public.writing_samples
  ADD COLUMN IF NOT EXISTS content_hash TEXT
  GENERATED ALWAYS AS (public.prose_content_hash(content)) STORED;

DELETE FROM public.writing_samples ws
USING (
  SELECT id, row_number() OVER (PARTITION BY user_id, content_hash ORDER BY created_at ASC, id ASC) AS rn
  FROM public.writing_samples
) d
WHERE ws.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS writing_samples_user_hash_uniq
  ON public.writing_samples (user_id, content_hash);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS writedna_stage TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS qualifying_prose_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_card_data JSONB,
  ADD COLUMN IF NOT EXISTS voice_card_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voice_card_model TEXT,
  ADD COLUMN IF NOT EXISTS voice_card_error TEXT,
  ADD COLUMN IF NOT EXISTS voice_card_source_hash TEXT,
  ADD COLUMN IF NOT EXISTS voice_card_source_resume_id UUID,
  ADD COLUMN IF NOT EXISTS voice_card_source_sample_ids UUID[],
  ADD COLUMN IF NOT EXISTS voice_card_prompt_version TEXT,
  ADD COLUMN IF NOT EXISTS voice_card_generation_id UUID,
  ADD COLUMN IF NOT EXISTS voice_card_generation_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fallback_choice_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_variant_id TEXT,
  ADD COLUMN IF NOT EXISTS ab_demo_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ab_demo_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ab_demo_answer TEXT,
  ADD COLUMN IF NOT EXISTS ab_demo_generation_id UUID,
  ADD COLUMN IF NOT EXISTS ab_demo_model TEXT,
  ADD COLUMN IF NOT EXISTS ab_demo_created_at TIMESTAMPTZ;

-- DROP old constraint BEFORE backfilling values to new vocabulary
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_voice_card_status_check;

UPDATE public.profiles SET voice_card_status = 'collecting_samples' WHERE voice_card_status = 'unlocking';
UPDATE public.profiles SET voice_card_status = CASE WHEN voice_card_data IS NOT NULL THEN 'generated' ELSE 'eligible' END
  WHERE voice_card_status = 'unlocked';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_voice_card_status_check
  CHECK (voice_card_status IN ('locked','collecting_samples','eligible','generating','generated','failed','stale'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_writedna_stage_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_writedna_stage_check
  CHECK (writedna_stage IN ('idle','building','good','strong'));

CREATE OR REPLACE FUNCTION public.recalc_writedna(_user_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  has_resume BOOLEAN; sample_count INT; new_stage TEXT; new_confidence INT;
  current_status TEXT; current_hash TEXT; new_status TEXT;
  qualifying_ids UUID[]; qualifying_hashes TEXT; resume_id UUID; next_hash TEXT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.resumes WHERE user_id = _user_id AND is_current = true) INTO has_resume;
  SELECT id INTO resume_id FROM public.resumes WHERE user_id = _user_id AND is_current = true ORDER BY uploaded_at DESC LIMIT 1;

  SELECT
    coalesce(array_agg(id ORDER BY created_at) FILTER (WHERE public.is_qualifying_prose(content, type)), '{}'::uuid[]),
    coalesce(string_agg(content_hash, ',' ORDER BY created_at) FILTER (WHERE public.is_qualifying_prose(content, type)), '')
  INTO qualifying_ids, qualifying_hashes
  FROM public.writing_samples WHERE user_id = _user_id;

  sample_count := coalesce(array_length(qualifying_ids, 1), 0);

  IF NOT has_resume THEN new_stage := 'idle'; new_confidence := 0;
  ELSIF sample_count = 0 THEN new_stage := 'building'; new_confidence := 35;
  ELSIF sample_count = 1 THEN new_stage := 'good'; new_confidence := 70;
  ELSE new_stage := 'strong'; new_confidence := 90;
  END IF;

  next_hash := encode(extensions.digest(coalesce(resume_id::text, '') || '|' || coalesce(qualifying_hashes, '') || '|v1', 'sha256'), 'hex');

  SELECT voice_card_status, voice_card_source_hash INTO current_status, current_hash FROM public.profiles WHERE id = _user_id;

  IF current_status = 'generating' THEN new_status := 'generating';
  ELSIF current_status = 'generated' THEN
    IF NOT has_resume OR sample_count < 2 THEN new_status := 'stale';
    ELSIF current_hash IS DISTINCT FROM next_hash THEN new_status := 'stale';
    ELSE new_status := 'generated'; new_confidence := 100; END IF;
  ELSIF current_status = 'stale' THEN
    IF NOT has_resume THEN new_status := 'locked';
    ELSIF sample_count < 2 THEN new_status := CASE WHEN sample_count = 0 THEN 'locked' ELSE 'collecting_samples' END;
    ELSIF current_hash IS NOT DISTINCT FROM next_hash THEN new_status := 'generated'; new_confidence := 100;
    ELSE new_status := 'stale'; END IF;
  ELSIF current_status = 'failed' THEN
    IF NOT has_resume THEN new_status := 'locked';
    ELSIF sample_count = 0 THEN new_status := 'locked';
    ELSIF sample_count = 1 THEN new_status := 'collecting_samples';
    ELSE new_status := 'failed'; END IF;
  ELSE
    IF NOT has_resume THEN new_status := 'locked';
    ELSIF sample_count = 0 THEN new_status := 'locked';
    ELSIF sample_count = 1 THEN new_status := 'collecting_samples';
    ELSE new_status := 'eligible'; END IF;
  END IF;

  UPDATE public.profiles
  SET writedna_stage = new_stage, voice_confidence = new_confidence, voice_card_status = new_status,
    resume_uploaded = has_resume, writing_sample_count = sample_count, qualifying_prose_count = sample_count,
    resume_only = CASE WHEN sample_count > 0 THEN false ELSE resume_only END, updated_at = now()
  WHERE id = _user_id;
END; $$;

DROP TRIGGER IF EXISTS trg_recalc_writedna_resumes ON public.resumes;
CREATE TRIGGER trg_recalc_writedna_resumes AFTER INSERT OR UPDATE OR DELETE ON public.resumes
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_writedna();

DROP TRIGGER IF EXISTS trg_recalc_writedna_samples ON public.writing_samples;
CREATE TRIGGER trg_recalc_writedna_samples AFTER INSERT OR UPDATE OR DELETE ON public.writing_samples
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_writedna();

DO $$ DECLARE r RECORD;
BEGIN FOR r IN SELECT id FROM public.profiles LOOP PERFORM public.recalc_writedna(r.id); END LOOP; END; $$;
