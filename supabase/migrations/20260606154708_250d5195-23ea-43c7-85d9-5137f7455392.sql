
-- Lock down SECURITY DEFINER helpers (trigger only)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- Storage policies: users access only files under their own user-id folder
CREATE POLICY "resume read own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "resume insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "resume update own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "resume delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'resumes' AND auth.uid()::text = (storage.foldername(name))[1]);
