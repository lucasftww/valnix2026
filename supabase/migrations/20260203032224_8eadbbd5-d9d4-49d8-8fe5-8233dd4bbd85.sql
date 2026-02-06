-- Adicionar campos para instruções e termos nos produtos
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS instructions TEXT NULL,
ADD COLUMN IF NOT EXISTS terms_conditions TEXT NULL;