
-- Create analytics_events table for tracking funnel events
CREATE TABLE public.analytics_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_id TEXT,
  page_url TEXT,
  device_type TEXT,
  browser TEXT,
  city TEXT,
  state TEXT,
  content_name TEXT,
  content_category TEXT,
  value NUMERIC,
  currency TEXT DEFAULT 'BRL',
  order_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Allow edge functions (service role) to insert/read
-- No public access needed - only service role via edge functions
CREATE POLICY "Service role full access"
  ON public.analytics_events
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create index for common queries
CREATE INDEX idx_analytics_events_name_time ON public.analytics_events(event_name, event_time DESC);
CREATE INDEX idx_analytics_events_time ON public.analytics_events(event_time DESC);
