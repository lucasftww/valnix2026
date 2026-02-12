
-- Table for guest order access links with delivery info
CREATE TABLE public.guest_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hash TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  email TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  guest_session_id TEXT,
  order_data JSONB NOT NULL DEFAULT '{}',
  linked BOOLEAN NOT NULL DEFAULT FALSE,
  user_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now() + INTERVAL '30 days'
);

-- Indexes for fast lookup
CREATE INDEX idx_guest_orders_hash ON public.guest_orders (hash);
CREATE INDEX idx_guest_orders_email ON public.guest_orders (email);
CREATE INDEX idx_guest_orders_user_id ON public.guest_orders (user_id);
CREATE INDEX idx_guest_orders_order_id ON public.guest_orders (order_id);

-- Enable RLS
ALTER TABLE public.guest_orders ENABLE ROW LEVEL SECURITY;

-- Anyone can read by hash (for the /order/:hash page)
CREATE POLICY "Read guest orders by hash"
ON public.guest_orders
FOR SELECT
USING (true);

-- Allow inserts (from edge functions or frontend after payment)
CREATE POLICY "Insert guest orders"
ON public.guest_orders
FOR INSERT
WITH CHECK (true);

-- Allow updates for linking (set linked=true, user_id)
CREATE POLICY "Update guest orders for linking"
ON public.guest_orders
FOR UPDATE
USING (true)
WITH CHECK (true);
