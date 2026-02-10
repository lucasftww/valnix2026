
-- Adicionar locked_at para lock atômico e attempt_count para controle de retries
ALTER TABLE public.utmify_event_log
  ADD COLUMN locked_at timestamptz DEFAULT NULL,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error text DEFAULT NULL;
