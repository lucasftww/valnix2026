
-- Tabela de configuração das páginas de upsell pós-pagamento
CREATE TABLE public.post_payment_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  addon_type TEXT NOT NULL UNIQUE, -- premium_benefits, delivery_priority, data_swap_warranty
  title TEXT NOT NULL DEFAULT 'Oferta Especial',
  subtitle TEXT,
  badge_text TEXT,
  badge_color TEXT DEFAULT 'yellow', -- yellow, orange, green
  benefits JSONB DEFAULT '[]'::jsonb, -- array of benefit strings
  price NUMERIC NOT NULL DEFAULT 0,
  original_price NUMERIC,
  button_accept_text TEXT DEFAULT 'SIM! EU QUERO!',
  button_skip_text TEXT DEFAULT 'Não, obrigado',
  next_route TEXT NOT NULL, -- route to redirect after action
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabela de transações de upsell
CREATE TABLE public.sale_addons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id TEXT NOT NULL,
  user_id TEXT,
  addon_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, paid, skipped, expired
  amount NUMERIC NOT NULL DEFAULT 0,
  pix_code TEXT,
  pix_qr_code TEXT,
  flowpay_charge_id TEXT,
  paid_at TIMESTAMPTZ,
  customer_email TEXT,
  customer_name TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.post_payment_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_addons ENABLE ROW LEVEL SECURITY;

-- post_payment_pages: readable by everyone (public config), writable by service role only
CREATE POLICY "Anyone can read active post_payment_pages"
  ON public.post_payment_pages FOR SELECT
  USING (true);

-- sale_addons: users can read their own, insert their own; service role manages all
CREATE POLICY "Anyone can insert sale_addons"
  ON public.sale_addons FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can read sale_addons"
  ON public.sale_addons FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update sale_addons"
  ON public.sale_addons FOR UPDATE
  USING (true);

-- Seed default upsell pages
INSERT INTO public.post_payment_pages (addon_type, title, subtitle, badge_text, badge_color, benefits, price, original_price, button_accept_text, button_skip_text, next_route, display_order) VALUES
(
  'premium_benefits',
  '🔥 Turbine sua Conta!',
  'Benefícios exclusivos para maximizar sua experiência',
  'Mais escolhido',
  'yellow',
  '["Suporte VIP prioritário 24h", "Garantia estendida de 30 dias", "Bônus exclusivo de 10% extra", "Acesso a promoções antecipadas"]'::jsonb,
  19.90,
  49.90,
  'SIM! EU QUERO POR APENAS R$ 19,90!',
  'Não, obrigado. Seguir sem benefícios.',
  '/painel-pagar-entrega',
  0
),
(
  'delivery_priority',
  '⚡ Entrega Prioritária',
  'Receba seu produto com prioridade máxima',
  'Mais rápido',
  'orange',
  '["Entrega em até 5 minutos", "Acompanhamento em tempo real", "Suporte dedicado na entrega", "Reenvio garantido se houver problema"]'::jsonb,
  14.90,
  39.90,
  'SIM! QUERO ENTREGA PRIORITÁRIA!',
  'Não, prefiro entrega normal.',
  '/painel-pagar-trocadados',
  1
),
(
  'data_swap_warranty',
  '🛡️ Garantia Troca de Dados',
  'Proteção total para sua conta e dados',
  'Proteção extra',
  'green',
  '["Troca de dados ilimitada por 30 dias", "Proteção contra banimento", "Backup dos seus dados", "Suporte técnico especializado"]'::jsonb,
  9.90,
  29.90,
  'SIM! QUERO PROTEÇÃO TOTAL!',
  'Não, seguir sem proteção.',
  '/',
  2
);

-- Index for performance
CREATE INDEX idx_sale_addons_order_id ON public.sale_addons (order_id);
CREATE INDEX idx_sale_addons_status ON public.sale_addons (status);
CREATE INDEX idx_sale_addons_addon_type ON public.sale_addons (addon_type);
