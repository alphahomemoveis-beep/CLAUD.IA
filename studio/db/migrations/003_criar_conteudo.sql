-- Criar conteúdo: a pessoa escolhe o formato, a IA pesquisa o que está em alta
-- e propõe 3 opções por rodada até uma ser escolhida; o app monta as artes ou o vídeo.

CREATE TABLE content_creations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          uuid NOT NULL REFERENCES brand_settings(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  format            text NOT NULL CHECK (format IN ('reels', 'feed', 'story', 'roteiro', 'carrossel')),
  theme             text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'pesquisando'
                    CHECK (status IN ('pesquisando', 'opcoes', 'escolhida', 'renderizando', 'pronto', 'falhou')),
  error             text,
  research          jsonb,
  chosen_option_id  uuid,
  -- Um fundo por peça: {peca, origem: upload|pasta|pexels, file_key, media_type, credito, credito_url}
  backgrounds       jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_media_ids  uuid[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX content_creations_brand_idx ON content_creations(brand_id, created_at DESC);

CREATE TABLE content_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creation_id  uuid NOT NULL REFERENCES content_creations(id) ON DELETE CASCADE,
  round        int NOT NULL,
  number       int NOT NULL,
  request      text NOT NULL DEFAULT '',
  data         jsonb NOT NULL,
  chosen       boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creation_id, round, number)
);

ALTER TABLE content_creations
  ADD CONSTRAINT content_creations_chosen_fk FOREIGN KEY (chosen_option_id) REFERENCES content_options(id) ON DELETE SET NULL;
