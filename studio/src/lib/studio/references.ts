import "server-only";
import { text as llm } from "../ai";
import { REFERENCE_CATEGORIES, ReferenceAnalysisSchema, type ReferenceAnalysis } from "../ai/schemas";
import { query, queryOne, tx } from "../db";
import { log } from "../logger";
import { effectiveAI, getBrand } from "../repo/brand";
import { storage } from "../storage";
import { VISION_MIMES } from "../uploads";
import { indexReference } from "./retrieval";

export interface ReferenceRow {
  id: string;
  brand_id: string;
  name: string;
  category: (typeof REFERENCE_CATEGORIES)[number];
  status: "referencia" | "em_avaliacao" | "aprovada" | "rejeitada";
  favorite: boolean;
  rating: number | null;
  media_type: "image" | "video";
  mime_type: string;
  file_key: string;
  file_size: number;
  source: "upload" | "gerada";
  visual_description: string;
  environment: string;
  palette: Array<{ nome: string; hex: string }>;
  materials: string[];
  style: string;
  recommended_use: string;
  analysis: ReferenceAnalysis | null;
  analysis_error: string | null;
  user_notes: string;
  created_at: string;
  updated_at: string;
  analyzed_at: string | null;
  tags?: string[];
}

export const REFERENCE_SELECT = `r.*, COALESCE((SELECT array_agg(tag ORDER BY tag) FROM reference_tags t WHERE t.reference_id = r.id), '{}') AS tags`;

export async function getReference(id: string, brandId: string) {
  return queryOne<ReferenceRow>(`SELECT ${REFERENCE_SELECT} FROM visual_references r WHERE r.id = $1 AND r.brand_id = $2`, [id, brandId]);
}

export async function setTags(referenceId: string, tags: string[]) {
  const clean = [...new Set(tags.map((t) => t.toLowerCase().trim().replace(/^#/, "").slice(0, 40)).filter(Boolean))].slice(0, 30);
  await tx(async (db) => {
    await db.query(`DELETE FROM reference_tags WHERE reference_id = $1`, [referenceId]);
    for (const t of clean) await db.query(`INSERT INTO reference_tags (reference_id, tag) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [referenceId, t]);
  });
}

/**
 * Analisa a referência com o modelo de visão e guarda tudo na memória
 * visual (RAG). Não altera nenhum modelo: só descreve, marca e indexa.
 */
export async function analyzeReference(id: string): Promise<ReferenceRow> {
  const brand = await getBrand();
  const cfg = effectiveAI(brand);
  const ref = await getReference(id, brand.id);
  if (!ref) throw new Error("Referência não encontrada");

  if (ref.media_type !== "image" || !VISION_MIMES.has(ref.mime_type)) {
    await query(
      `UPDATE visual_references SET analysis_error = $1, status = CASE WHEN status = 'referencia' THEN 'em_avaliacao' ELSE status END, updated_at = now() WHERE id = $2`,
      ["Vídeo guardado. A análise automática de vídeo ainda não é suportada: descreva a referência nas notas.", id],
    );
    await indexReference(id, cfg).catch((err) => log.warn("indexacao_falhou", { err }));
    return (await getReference(id, brand.id))!;
  }

  try {
    const file = await storage().get(ref.file_key);
    if (!file) throw new Error("Arquivo da referência não encontrado no armazenamento.");
    const { data } = await llm().structured({
      schemaName: "analise_referencia",
      schema: ReferenceAnalysisSchema,
      model: cfg.visionModel,
      images: [{ mime: ref.mime_type, data: file }],
      system: `Você é diretor de arte da marca ${brand.name} (${brand.positioning}). Analise a imagem como referência visual
para futuras criações. Seja específico e técnico: ambiente, estilo, cores com hex aproximado, materiais, iluminação,
enquadramento, composição, arquitetura, móveis, nível de realismo, tipografia, direção de arte, sensação transmitida,
características interessantes, o que evitar e como usar como referência. Responda em português.`,
      messages: [{ role: "user", text: `Analise esta referência.${ref.user_notes ? ` Notas da marca: ${ref.user_notes}` : ""}` }],
    });
    await query(
      `UPDATE visual_references SET
         analysis = $1, analysis_error = NULL, analyzed_at = now(), updated_at = now(),
         visual_description = $2, environment = $3, palette = $4, materials = $5, style = $6, recommended_use = $7,
         name = CASE WHEN name = '' OR name = $8 THEN $9 ELSE name END,
         status = CASE WHEN status = 'referencia' THEN 'em_avaliacao' ELSE status END
       WHERE id = $10`,
      [JSON.stringify(data), data.descricao_visual, data.ambiente, JSON.stringify(data.cores), JSON.stringify(data.materiais),
       data.estilo, data.usos_recomendados.join("; "), "Sem nome", data.nome_sugerido.slice(0, 120), id],
    );
    const existing = ref.tags ?? [];
    await setTags(id, [...existing, ...data.tags]);
  } catch (err) {
    log.warn("analise_referencia_falhou", { id, err });
    await query(`UPDATE visual_references SET analysis_error = $1, updated_at = now() WHERE id = $2`, [
      `A análise falhou: ${err instanceof Error ? err.message.slice(0, 300) : "erro desconhecido"}`, id,
    ]);
  }
  await indexReference(id, cfg).catch((err) => log.warn("indexacao_falhou", { err }));
  return (await getReference(id, brand.id))!;
}
