
-- Tabela para dedupe persistente de eventos UTMify
CREATE TABLE public.utmify_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  order_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index para cleanup por data
CREATE INDEX idx_utmify_event_log_created_at ON public.utmify_event_log (created_at);

-- RLS: apenas service_role pode acessar
ALTER TABLE public.utmify_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access utmify_event_log"
  ON public.utmify_event_log
  FOR ALL
  USING (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text)
  WITH CHECK (((current_setting('request.jwt.claims'::text, true))::json ->> 'role'::text) = 'service_role'::text);
