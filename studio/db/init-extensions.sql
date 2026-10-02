-- Extensões exigidas pela migração. Criar como superusuário
-- (no Supabase: Database > Extensions > vector e pgcrypto).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
