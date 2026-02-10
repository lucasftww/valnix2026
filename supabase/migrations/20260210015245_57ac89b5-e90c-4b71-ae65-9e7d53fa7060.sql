
-- Adicionar status e updated_at para controle pending/sent
ALTER TABLE public.utmify_event_log
  ADD COLUMN status text NOT NULL DEFAULT 'pending',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
