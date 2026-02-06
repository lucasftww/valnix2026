-- Adicionar campos de avatar e apelido na tabela profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS nickname TEXT;

-- Criar bucket para avatares de usuários
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Política para visualização pública dos avatares
CREATE POLICY "Avatars são públicos" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'avatars');

-- Política para upload do próprio avatar
CREATE POLICY "Usuários podem fazer upload do próprio avatar" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Política para atualizar o próprio avatar
CREATE POLICY "Usuários podem atualizar o próprio avatar" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Política para deletar o próprio avatar
CREATE POLICY "Usuários podem deletar o próprio avatar" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);