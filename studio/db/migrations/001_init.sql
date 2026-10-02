-- AlphaHome Creative Studio: esquema inicial
-- Requer PostgreSQL 15+ com as extensões pgvector e pgcrypto.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Usuários e sessões ---------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  disabled      boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip          text,
  user_agent  text,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- Marca ----------------------------------------------------------------------
-- Uma linha por marca. Hoje existe só a AlphaHome, mas todas as tabelas
-- apontam para brand_id para permitir crescer para várias marcas.
CREATE TABLE brand_settings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  positioning     text NOT NULL DEFAULT '',
  identity        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_file_key   text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Prompt Mestre: cada prompt tem várias versões; só uma versão fica ativa por
-- prompt, e o prompt inteiro pode ser ligado ou desligado.
CREATE TABLE master_prompts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  enabled      boolean NOT NULL DEFAULT true,
  sort_order   int NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prompt_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_prompt_id uuid NOT NULL REFERENCES master_prompts(id) ON DELETE CASCADE,
  version          int NOT NULL,
  content          text NOT NULL,
  notes            text NOT NULL DEFAULT '',
  is_active        boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_prompt_id, version)
);
CREATE UNIQUE INDEX prompt_versions_one_active
  ON prompt_versions(master_prompt_id) WHERE is_active;

-- Biblioteca visual ------------------------------------------------------------
CREATE TABLE visual_references (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  name               text NOT NULL,
  category           text NOT NULL DEFAULT 'ambientes'
                     CHECK (category IN ('identidade','ambientes','materiais','iluminacao','arquitetura',
                                         'instagram','tipografia','assinatura','fotografia')),
  status             text NOT NULL DEFAULT 'referencia'
                     CHECK (status IN ('referencia','em_avaliacao','aprovada','rejeitada')),
  favorite           boolean NOT NULL DEFAULT false,
  rating             smallint CHECK (rating BETWEEN 1 AND 5),
  media_type         text NOT NULL CHECK (media_type IN ('image','video')),
  mime_type          text NOT NULL,
  file_key           text NOT NULL,
  file_size          int NOT NULL,
  source             text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','gerada')),
  visual_description text NOT NULL DEFAULT '',
  environment        text NOT NULL DEFAULT '',
  palette            jsonb NOT NULL DEFAULT '[]'::jsonb,
  materials          jsonb NOT NULL DEFAULT '[]'::jsonb,
  style              text NOT NULL DEFAULT '',
  recommended_use    text NOT NULL DEFAULT '',
  analysis           jsonb,
  analysis_error     text,
  user_notes         text NOT NULL DEFAULT '',
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  analyzed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visual_references_brand_status_idx ON visual_references(brand_id, status);

CREATE TABLE reference_tags (
  reference_id uuid NOT NULL REFERENCES visual_references(id) ON DELETE CASCADE,
  tag          text NOT NULL,
  PRIMARY KEY (reference_id, tag)
);
CREATE INDEX reference_tags_tag_idx ON reference_tags(tag);

-- A coluna vector não fixa dimensões para permitir trocar o modelo de
-- embeddings. A busca sempre filtra pelo modelo usado.
CREATE TABLE visual_embeddings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id  uuid NOT NULL REFERENCES visual_references(id) ON DELETE CASCADE,
  model         text NOT NULL,
  dimensions    int NOT NULL,
  content       text NOT NULL,
  embedding     vector NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reference_id, model)
);

-- Projetos, conversas e mensagens ---------------------------------------------
CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL DEFAULT 'Nova conversa',
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creative_projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  title             text NOT NULL,
  content_type      text NOT NULL CHECK (content_type IN ('carrossel','reels','arte','imagem','story')),
  -- etapa do fluxo: briefing > conceitos > planejamento > aprovado > gerado
  stage             text NOT NULL DEFAULT 'briefing'
                    CHECK (stage IN ('briefing','conceitos','planejamento','aprovado','gerado')),
  status            text NOT NULL DEFAULT 'em_desenvolvimento'
                    CHECK (status IN ('em_desenvolvimento','em_revisao','concluido','arquivado')),
  briefing          jsonb NOT NULL DEFAULT '{}'::jsonb,
  research          jsonb,
  chosen_concept_id uuid,
  current_version   int NOT NULL DEFAULT 0,
  multi_environment boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creative_projects_brand_idx ON creative_projects(brand_id, updated_at DESC);
CREATE UNIQUE INDEX creative_projects_conversation_idx ON creative_projects(conversation_id);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user','assistant','system')),
  kind             text NOT NULL DEFAULT 'text',
  content          text NOT NULL DEFAULT '',
  payload          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);

CREATE TABLE concepts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
  round         int NOT NULL DEFAULT 1,
  number        int NOT NULL,
  title         text NOT NULL,
  environment   text NOT NULL,
  data          jsonb NOT NULL,
  reference_ids uuid[] NOT NULL DEFAULT '{}',
  chosen        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, round, number)
);

ALTER TABLE creative_projects
  ADD CONSTRAINT creative_projects_chosen_concept_fk
  FOREIGN KEY (chosen_concept_id) REFERENCES concepts(id) ON DELETE SET NULL;

CREATE TABLE creative_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
  concept_id    uuid NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  version       int NOT NULL,
  data          jsonb NOT NULL,
  reference_ids uuid[] NOT NULL DEFAULT '{}',
  approved      boolean NOT NULL DEFAULT false,
  approved_at   timestamptz,
  approved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

-- Cada linha é uma peça (um slide, uma arte ou uma capa) numa versão. O prompt
-- final e o checklist de qualidade ficam guardados antes da geração.
CREATE TABLE generated_images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES creative_projects(id) ON DELETE CASCADE,
  plan_id         uuid NOT NULL REFERENCES creative_plans(id) ON DELETE CASCADE,
  slide_number    int NOT NULL,
  slide_role      text NOT NULL DEFAULT '',
  version         int NOT NULL,
  prompt          text NOT NULL,
  quality_review  jsonb,
  status          text NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','gerando','pronta','falhou')),
  error           text,
  provider        text,
  model           text,
  size            text,
  file_key        text,
  revision_of     uuid REFERENCES generated_images(id) ON DELETE SET NULL,
  verdict         text CHECK (verdict IN ('aprovada','rejeitada','alteracao')),
  favorite        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  generated_at    timestamptz,
  UNIQUE (project_id, slide_number, version)
);

CREATE TABLE feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES creative_projects(id) ON DELETE CASCADE,
  image_id    uuid REFERENCES generated_images(id) ON DELETE CASCADE,
  plan_id     uuid REFERENCES creative_plans(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('aprovar','rejeitar','favoritar','alterar')),
  comment     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE brand_preferences (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  project_id         uuid REFERENCES creative_projects(id) ON DELETE CASCADE,
  scope              text NOT NULL DEFAULT 'marca' CHECK (scope IN ('marca','projeto')),
  kind               text NOT NULL DEFAULT 'evitar' CHECK (kind IN ('preferir','evitar','regra')),
  rule               text NOT NULL,
  source             text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','feedback')),
  source_feedback_id uuid REFERENCES feedback(id) ON DELETE SET NULL,
  active             boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_preferences_brand_idx ON brand_preferences(brand_id, active);

-- Registro de atividades (auditoria) --------------------------------------------
CREATE TABLE activity_logs (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  details     jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_logs_created_idx ON activity_logs(created_at DESC);
