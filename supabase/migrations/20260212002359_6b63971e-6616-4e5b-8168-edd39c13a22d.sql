
CREATE TABLE public.capi_event_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  status_code INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.capi_event_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_capi_event_log_order_id ON public.capi_event_log(order_id);
CREATE INDEX idx_capi_event_log_created_at ON public.capi_event_log(created_at DESC);
