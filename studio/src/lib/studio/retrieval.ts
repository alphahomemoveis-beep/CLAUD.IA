import "server-only";
import { query, toVector } from "../db";
import { embeddings } from "../ai";
import type { EffectiveAI } from "../repo/brand";
import type { ReferenceAnalysis } from "../ai/schemas";
import { log } from "../logger";
import { toTsQuery } from "./tsquery";

export interface RetrievedReference {
  id: string;
  name: string;
  category: string;
  status: string;
  favorite: boolean;
  rating: number | null;
  visual_description: string;
  environment: string;
  style: string;
  palette: Array<{ nome: string; hex: string }>;
  materials: string[];
  recommended_use: string;
  file_key: string;
  mime_type: string;
  media_type: string;
  analysis: ReferenceAnalysis | null;
  similarity: number | null;
}

export function embeddingModelName(cfg: EffectiveAI) {
  return embeddings()?.model ?? cfg.embeddingModel;
}

/** Texto que representa a referência na busca semântica. */
export function referenceEmbeddingText(r: {
  name: string; category: string; visual_description: string; environment: string; style: string;
  recommended_use: string; user_notes?: string; analysis: ReferenceAnalysis | null; tags?: string[];
}) {
  const a = r.analysis;
  return [
    r.name, r.category, r.visual_description, r.environment, r.style, r.recommended_use, r.user_notes ?? "",
    a ? [a.materiais.join(", "), a.iluminacao, a.composicao, a.sensacao, a.direcao_arte, a.moveis.join(", "),
         a.cores.map((c) => c.nome).join(", "), a.usos_recomendados.join(", ")].join(". ") : "",
    (r.tags ?? []).join(", "),
  ].filter(Boolean).join("\n");
}

/** Gera (ou refaz) o embedding de uma referência. */
export async function indexReference(referenceId: string, cfg: EffectiveAI) {
  const rows = await query<RetrievedReference & { user_notes: string; tags: string[] }>(
    `SELECT r.*, COALESCE(array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
       FROM visual_references r LEFT JOIN reference_tags t ON t.reference_id = r.id
      WHERE r.id = $1 GROUP BY r.id`,
    [referenceId],
  );
  const ref = rows[0];
  if (!ref) return;
  const content = referenceEmbeddingText(ref);
  const model = embeddingModelName(cfg);
  const provider = embeddings();
  const vector = provider ? (await provider.embed([content]))[0] : null;
  await query(
    `INSERT INTO visual_embeddings (reference_id, model, dimensions, content, embedding)
     VALUES ($1,$2,$3,$4,$5::vector)
     ON CONFLICT (reference_id, model) DO UPDATE
       SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, dimensions = EXCLUDED.dimensions, created_at = now()`,
    [referenceId, model, vector?.length ?? 0, content, vector ? toVector(vector) : null],
  );
}

const SELECT_REF = `r.id, r.name, r.category, r.status, r.favorite, r.rating, r.visual_description, r.environment,
  r.style, r.palette, r.materials, r.recommended_use, r.file_key, r.mime_type, r.media_type, r.analysis`;

/**
 * Recupera as referências mais relevantes para um pedido.
 * Considera as aprovadas e as favoritas, com bônus para favoritas e boas notas.
 */
export async function retrieveReferences(brandId: string, text: string, cfg: EffectiveAI, limit = cfg.maxReferences): Promise<RetrievedReference[]> {
  const model = embeddingModelName(cfg);
  const provider = embeddings();
  try {
    if (provider) {
      const [vector] = await provider.embed([text]);
      const rows = await query<RetrievedReference>(
        `SELECT ${SELECT_REF}, 1 - (e.embedding <=> $1::vector) AS similarity
           FROM visual_references r
           JOIN visual_embeddings e ON e.reference_id = r.id AND e.model = $2 AND e.dimensions = $3
          WHERE r.brand_id = $4 AND (r.status = 'aprovada' OR (r.favorite AND r.status <> 'rejeitada'))
          ORDER BY (1 - (e.embedding <=> $1::vector))
                   + CASE WHEN r.favorite THEN 0.08 ELSE 0 END
                   + COALESCE(r.rating, 3) * 0.01 DESC
          LIMIT $5`,
        [toVector(vector), model, vector.length, brandId, limit],
      );
      if (rows.length) return rows;
    } else {
      // Sem provedor de embeddings: busca de texto completo em português.
      const tsq = toTsQuery(text);
      if (tsq) {
        const rows = await query<RetrievedReference>(
          `SELECT ${SELECT_REF}, ts_rank(to_tsvector('portuguese', e.content), to_tsquery('portuguese', $1)) AS similarity
             FROM visual_references r
             JOIN visual_embeddings e ON e.reference_id = r.id AND e.model = $2
            WHERE r.brand_id = $3 AND (r.status = 'aprovada' OR (r.favorite AND r.status <> 'rejeitada'))
            ORDER BY ts_rank(to_tsvector('portuguese', e.content), to_tsquery('portuguese', $1))
                     + CASE WHEN r.favorite THEN 0.05 ELSE 0 END
                     + COALESCE(r.rating, 3) * 0.01 DESC
            LIMIT $4`,
          [tsq, model, brandId, limit],
        );
        if (rows.some((r) => (r.similarity ?? 0) > 0)) return rows;
      }
    }
  } catch (err) {
    log.warn("busca_referencias_falhou", { err });
  }
  // Sem embeddings ainda: usa as aprovadas mais bem avaliadas.
  return query<RetrievedReference>(
    `SELECT ${SELECT_REF}, NULL::float AS similarity FROM visual_references r
      WHERE r.brand_id = $1 AND (r.status = 'aprovada' OR (r.favorite AND r.status <> 'rejeitada'))
      ORDER BY r.favorite DESC, r.rating DESC NULLS LAST, r.created_at DESC LIMIT $2`,
    [brandId, limit],
  );
}

/** O que evitar, tirado das referências rejeitadas. */
export async function rejectedSignals(brandId: string): Promise<string[]> {
  const rows = await query<{ name: string; analysis: ReferenceAnalysis | null; user_notes: string }>(
    `SELECT name, analysis, user_notes FROM visual_references
      WHERE brand_id = $1 AND status = 'rejeitada' ORDER BY updated_at DESC LIMIT 5`,
    [brandId],
  );
  return rows.map((r) => {
    const why = [r.user_notes, ...(r.analysis?.evitar ?? []), r.analysis?.direcao_arte ?? ""].filter(Boolean).join("; ");
    return `${r.name}: ${why || "rejeitada pela marca"}`;
  });
}

export function formatReferences(refs: RetrievedReference[]): string {
  if (!refs.length) return "Nenhuma referência aprovada na biblioteca ainda. Siga a identidade da marca.";
  return refs
    .map((r) => {
      const flags = [r.status === "aprovada" ? "APROVADA" : r.status.toUpperCase(), r.favorite ? "FAVORITA" : "", r.rating ? `nota ${r.rating}/5` : ""]
        .filter(Boolean).join(", ");
      const a = r.analysis;
      return [
        `- [${r.id}] ${r.name} (${r.category}; ${flags})`,
        `  Descrição: ${r.visual_description}`,
        r.environment ? `  Ambiente: ${r.environment}` : "",
        r.palette?.length ? `  Paleta: ${r.palette.map((c) => `${c.nome} ${c.hex}`).join(", ")}` : "",
        r.materials?.length ? `  Materiais: ${r.materials.join(", ")}` : "",
        a ? `  Iluminação: ${a.iluminacao}. Composição: ${a.composicao}. Sensação: ${a.sensacao}.` : "",
        a?.evitar?.length ? `  Evitar: ${a.evitar.join("; ")}` : "",
        r.recommended_use ? `  Uso recomendado: ${r.recommended_use}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n");
}
