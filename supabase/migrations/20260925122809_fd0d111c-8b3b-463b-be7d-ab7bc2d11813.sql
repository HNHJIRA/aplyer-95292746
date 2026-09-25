ALTER TABLE public.demo_requests
  ADD COLUMN IF NOT EXISTS chatgpt_model_returned text,
  ADD COLUMN IF NOT EXISTS chatgpt_model_requested text,
  ADD COLUMN IF NOT EXISTS chatgpt_input_tokens integer,
  ADD COLUMN IF NOT EXISTS chatgpt_output_tokens integer;