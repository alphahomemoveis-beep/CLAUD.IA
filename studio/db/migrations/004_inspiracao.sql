-- Criar a partir de um vídeo de inspiração: o arquivo ou o link, os cortes
-- medidos e o estilo que a IA leu.
ALTER TABLE content_creations ADD COLUMN IF NOT EXISTS inspiration jsonb;
