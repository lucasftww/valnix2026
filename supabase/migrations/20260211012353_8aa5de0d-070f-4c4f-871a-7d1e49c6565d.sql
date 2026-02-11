
CREATE TABLE public.site_banners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  image_url TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  link_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.site_banners ENABLE ROW LEVEL SECURITY;

-- Banners são públicos para leitura
CREATE POLICY "Banners are publicly readable"
ON public.site_banners
FOR SELECT
USING (true);

-- Apenas admins podem gerenciar (via edge functions com service role)
CREATE POLICY "Service role can manage banners"
ON public.site_banners
FOR ALL
USING (auth.role() = 'service_role');
