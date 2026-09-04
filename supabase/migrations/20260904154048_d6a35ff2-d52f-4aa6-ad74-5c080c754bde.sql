CREATE OR REPLACE FUNCTION public.recalc_writedna(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  -- WriteDNA progress = milestones / 3:
  --   1) resume uploaded, 2) first qualifying sample, 3) second qualifying sample.
  -- No resume => 0%. Resume only => 33%. +1 sample => 67%. +2 samples => 100%.
  IF NOT has_resume THEN
    new_confidence := 0;
  ELSE
    new_confidence := (ARRAY[33, 67, 100])[least(sample_count, 2) + 1];
  END IF;

  IF sample_count = 0 THEN
    new_stage := CASE WHEN has_resume THEN 'building' ELSE 'idle' END;
  ELSIF sample_count = 1 THEN
    new_stage := 'good';
  ELSE
    new_stage := 'strong';
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
END; $function$;

-- Backfill every existing profile with the corrected progress.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.profiles LOOP
    PERFORM public.recalc_writedna(r.id);
  END LOOP;
END $$;