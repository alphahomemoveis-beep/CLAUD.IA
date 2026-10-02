-- Pastas de obras, agenda de posts e jornal de métricas.

-- Integrações da marca (IDs não secretos; tokens ficam em variáveis de ambiente)
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS integrations jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Conversas do estúdio criativo e da agenda ficam na mesma tabela.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'estudio'
  CHECK (kind IN ('estudio', 'agenda'));

-- Embeddings opcionais: sem provedor de embeddings, a busca usa texto completo.
ALTER TABLE visual_embeddings ALTER COLUMN embedding DROP NOT NULL;

-- Pastas -----------------------------------------------------------------------
-- Árvore livre: "Condomínio La Paloma" > "Casa 12". Toda pasta tem as etapas
-- Projeto, Obra e Resultado.
CREATE TABLE folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES folders(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  address     text NOT NULL DEFAULT '',
  client_name text NOT NULL DEFAULT '',
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX folders_parent_idx ON folders(brand_id, parent_id);
CREATE UNIQUE INDEX folders_unique_name ON folders(brand_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE TABLE folder_media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  folder_id     uuid NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  stage         text NOT NULL CHECK (stage IN ('projeto', 'obra', 'resultado')),
  media_type    text NOT NULL CHECK (media_type IN ('image', 'video')),
  mime_type     text NOT NULL,
  file_key      text NOT NULL,
  file_size     bigint NOT NULL,
  original_name text NOT NULL DEFAULT '',
  caption       text NOT NULL DEFAULT '',
  reference_id  uuid REFERENCES visual_references(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX folder_media_folder_idx ON folder_media(folder_id, stage, created_at DESC);

-- Agenda de posts --------------------------------------------------------------
CREATE TABLE scheduled_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  post_type       text NOT NULL DEFAULT 'REEL' CHECK (post_type IN ('POST', 'CARROSSEL', 'REEL', 'STORY')),
  networks        text[] NOT NULL DEFAULT '{instagram}',
  caption         text NOT NULL DEFAULT '',
  hashtags        text[] NOT NULL DEFAULT '{}',
  first_comment   text NOT NULL DEFAULT '',
  media_ids       uuid[] NOT NULL DEFAULT '{}',
  scheduled_at    timestamptz NOT NULL,
  timezone        text NOT NULL DEFAULT 'America/Sao_Paulo',
  -- rascunho: proposto pela IA, aguardando confirmação de um dono ou gerente
  status          text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho', 'agendado', 'publicado', 'falhou', 'cancelado')),
  pending_action  text CHECK (pending_action IN ('cancelar')),
  delivery        text NOT NULL DEFAULT 'manual' CHECK (delivery IN ('metricool', 'manual')),
  external_id     text,
  external_error  text,
  notes           text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_posts_when_idx ON scheduled_posts(brand_id, scheduled_at);

-- Jornal de métricas -------------------------------------------------------------
CREATE TABLE tracked_profiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id               uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  network                text NOT NULL DEFAULT 'instagram',
  handle                 text NOT NULL,
  display_name           text NOT NULL DEFAULT '',
  is_own                 boolean NOT NULL DEFAULT false,
  metricool_competitor_id text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, network, handle)
);

-- Uma linha por perfil e dia. Fonte diz de onde veio o número.
CREATE TABLE profile_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES tracked_profiles(id) ON DELETE CASCADE,
  day           date NOT NULL,
  source        text NOT NULL CHECK (source IN ('windsor', 'metricool', 'manual')),
  followers     bigint,
  reach         bigint,
  impressions   bigint,
  views         bigint,
  profile_views bigint,
  interactions  bigint,
  posts         int,
  raw           jsonb,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, day, source)
);
CREATE INDEX profile_metrics_day_idx ON profile_metrics(profile_id, day);

CREATE TABLE sync_runs (
  id          bigserial PRIMARY KEY,
  brand_id    uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  source      text NOT NULL,
  ok          boolean NOT NULL,
  rows        int NOT NULL DEFAULT 0,
  message     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journal_editions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  period_days  int NOT NULL,
  period_end   date NOT NULL,
  data         jsonb NOT NULL,
  editorial    jsonb NOT NULL,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_editions_idx ON journal_editions(brand_id, period_end DESC, period_days);
