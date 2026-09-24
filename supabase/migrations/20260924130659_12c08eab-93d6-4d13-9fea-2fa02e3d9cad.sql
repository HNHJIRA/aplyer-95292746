ALTER TABLE public.demo_requests
  ADD COLUMN chatgpt_answer text,
  ADD COLUMN chatgpt_prompt text,
  ADD COLUMN chatgpt_status text NOT NULL DEFAULT 'pending'
    CHECK (chatgpt_status IN ('pending','completed','failed','not_configured'));