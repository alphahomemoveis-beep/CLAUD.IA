import "server-only";
import { query, queryOne, tx } from "../db";
import { ensureBrand } from "../brand-defaults";
import { defaultEmbeddingModel, defaultTextModel, env } from "../env";

export interface BrandIdentity {
  atributos?: string;
  tom_de_voz?: string;
  publico?: string;
  instagram?: string;
  logo_regras?: string;
  assinatura_regras?: string;
  assinatura_fantasma?: boolean;
  assinatura_fantasma_texto?: string;
  cores_marca?: string[];
  evitar?: string;
}

export interface AISettings {
  text_model?: string;
  vision_model?: string;
  image_model?: string;
  image_quality?: "low" | "medium" | "high" | "xhigh" | "max" | "auto";
  web_search?: boolean;
  concept_count?: number;
  use_reference_images?: boolean;
  max_references?: number;
}

export interface Integrations {
  metricool_blog_id?: string;
  instagram_handle?: string;
}

export interface Brand {
  id: string;
  integrations: Integrations;
  name: string;
  positioning: string;
  identity: BrandIdentity;
  ai_settings: AISettings;
  logo_file_key: string | null;
  updated_at: string;
}

/** Modelo salvo só vale se for do provedor ativo (evita mandar "gpt-5.5" ao Claude). */
function compatible(model: string | undefined, provider: string) {
  if (!model) return undefined;
  if (provider === "anthropic") return model.startsWith("claude-") ? model : undefined;
  if (provider === "openai") return model.startsWith("claude-") ? undefined : model;
  return model;
}

/** Configuração efetiva: o que foi salvo na marca, com os padrões do servidor. */
export function effectiveAI(brand: Brand) {
  const e = env();
  const s = brand.ai_settings ?? {};
  const textModel = compatible(s.text_model, e.AI_PROVIDER) ?? e.AI_TEXT_MODEL ?? defaultTextModel(e.AI_PROVIDER);
  return {
    provider: e.AI_PROVIDER,
    imageProvider: e.IMAGE_PROVIDER,
    embeddingProvider: e.EMBEDDING_PROVIDER,
    textModel,
    visionModel: compatible(s.vision_model, e.AI_PROVIDER) ?? e.AI_VISION_MODEL ?? textModel,
    imageModel: s.image_model || e.AI_IMAGE_MODEL,
    embeddingModel: e.AI_EMBEDDING_MODEL ?? defaultEmbeddingModel(e.EMBEDDING_PROVIDER),
    imageQuality: s.image_quality ?? "high",
    webSearch: s.web_search ?? true,
    conceptCount: Math.min(5, Math.max(3, s.concept_count ?? 5)),
    useReferenceImages: s.use_reference_images ?? false,
    maxReferences: Math.min(12, Math.max(2, s.max_references ?? 6)),
  };
}
export type EffectiveAI = ReturnType<typeof effectiveAI>;

export async function getBrand(): Promise<Brand> {
  const brand = await queryOne<Brand>(`SELECT * FROM brand_settings ORDER BY created_at LIMIT 1`);
  if (brand) return brand;
  // Primeiro uso: cria a marca AlphaHome e o Prompt Mestre inicial.
  await tx((db) => ensureBrand(db as never));
  return (await queryOne<Brand>(`SELECT * FROM brand_settings ORDER BY created_at LIMIT 1`))!;
}

export async function updateBrand(id: string, patch: Partial<Pick<Brand, "name" | "positioning" | "identity" | "ai_settings" | "logo_file_key" | "integrations">>) {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    values.push(k === "identity" || k === "ai_settings" || k === "integrations" ? JSON.stringify(v) : v);
    fields.push(`${k} = $${values.length}`);
  }
  if (!fields.length) return getBrand();
  values.push(id);
  const rows = await query<Brand>(
    `UPDATE brand_settings SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return rows[0];
}
