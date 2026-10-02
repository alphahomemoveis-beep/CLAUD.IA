import "server-only";
import { images, imageSizeFor } from "../ai";
import { query, queryOne } from "../db";
import { log } from "../logger";
import { effectiveAI, getBrand } from "../repo/brand";
import { getImage, type ImageRow, type PlanRow, type Project } from "../repo/projects";
import { newKey, storage } from "../storage";
import { VISION_MIMES } from "../uploads";
import { assertCanGenerate, WorkflowError } from "./workflow";
import { logActivity } from "../activity";
import type { InputImage } from "../ai/types";

/**
 * Gera UMA imagem (uma peça). Cada slide de carrossel é chamado separadamente,
 * então nunca existe "todos os slides numa imagem só".
 */
/** Confere a regra absoluta para uma peça. Usada na geração e no envio manual. */
export async function assertPieceIsGeneratable(image: ImageRow) {
  const project = (await queryOne<Project>(`SELECT * FROM creative_projects WHERE id = $1`, [image.project_id]))!;
  const plan = (await queryOne<PlanRow>(`SELECT * FROM creative_plans WHERE id = $1`, [image.plan_id]))!;
  const latest = await queryOne<{ id: string; approved: boolean }>(
    `SELECT id, approved FROM creative_plans WHERE project_id = $1 ORDER BY version DESC LIMIT 1`, [project.id]);
  const isCurrent = !!latest && latest.id === plan.id && latest.approved && plan.concept_id === project.chosen_concept_id;
  assertCanGenerate({ stage: project.stage, chosenConceptId: project.chosen_concept_id, approvedPlanId: isCurrent ? plan.id : null });
  return { project, plan };
}

export async function generateImage(imageId: string, userId: string): Promise<ImageRow> {
  const brand = await getBrand();
  const cfg = effectiveAI(brand);
  const image = await getImage(imageId, brand.id);
  if (!image) throw new WorkflowError("Peça não encontrada.");
  const project = (await queryOne<Project>(`SELECT * FROM creative_projects WHERE id = $1`, [image.project_id]))!;
  const plan = (await queryOne<PlanRow>(`SELECT * FROM creative_plans WHERE id = $1`, [image.plan_id]))!;

  // REGRA ABSOLUTA, conferida no servidor a cada geração: a peça precisa
  // pertencer ao planejamento aprovado mais recente do conceito escolhido.
  const latest = await queryOne<{ id: string; approved: boolean }>(
    `SELECT id, approved FROM creative_plans WHERE project_id = $1 ORDER BY version DESC LIMIT 1`, [project.id]);
  const isCurrent = !!latest && latest.id === plan.id && latest.approved && plan.concept_id === project.chosen_concept_id;
  assertCanGenerate({
    stage: project.stage,
    chosenConceptId: project.chosen_concept_id,
    approvedPlanId: isCurrent ? plan.id : null,
  });
  if (image.status === "gerando") throw new WorkflowError("Esta peça já está sendo gerada.");
  if (image.status === "pronta") return image;

  // Trava otimista: só uma requisição muda pendente/falhou para gerando.
  const locked = await queryOne<ImageRow>(
    `UPDATE generated_images SET status = 'gerando', error = NULL WHERE id = $1 AND status IN ('pendente','falhou') RETURNING *`,
    [image.id],
  );
  if (!locked) throw new WorkflowError("Esta peça já está sendo gerada.");

  const generator = images();
  if (!generator) {
    await query(`UPDATE generated_images SET status = 'pendente' WHERE id = $1`, [image.id]);
    throw new WorkflowError("A geração automática de imagem está desligada. Copie o prompt final, gere a imagem onde preferir e envie a imagem pronta nesta peça.");
  }

  try {
    const size = imageSizeFor(generator.name === "mock" ? "mock" : cfg.imageModel, plan.data.proporcao);
    const referenceImages = cfg.useReferenceImages ? await loadReferenceImages(plan.reference_ids) : [];
    const result = await generator.image({
      prompt: image.prompt,
      model: generator.name === "mock" ? "mock" : cfg.imageModel,
      size,
      quality: cfg.imageQuality,
      referenceImages,
    });
    const key = newKey("geradas", result.ext);
    await storage().put(key, result.data, result.mime);
    const done = await queryOne<ImageRow>(
      `UPDATE generated_images SET status = 'pronta', file_key = $1, provider = $2, model = $3, size = $4, generated_at = now()
        WHERE id = $5 RETURNING *`,
      [key, generator.name, result.model, size, image.id],
    );
    await query(`UPDATE creative_projects SET stage = 'gerado', updated_at = now() WHERE id = $1`, [project.id]);
    await logActivity(userId, "imagem_gerada", "generated_images", image.id, { modelo: result.model, tamanho: size });
    return done!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("geracao_falhou", { imageId, err });
    const failed = await queryOne<ImageRow>(
      `UPDATE generated_images SET status = 'falhou', error = $1 WHERE id = $2 RETURNING *`,
      [message.slice(0, 500), image.id],
    );
    return failed!;
  }
}

async function loadReferenceImages(ids: string[]): Promise<InputImage[]> {
  if (!ids.length) return [];
  const rows = await query<{ file_key: string; mime_type: string }>(
    `SELECT file_key, mime_type FROM visual_references
      WHERE id = ANY($1::uuid[]) AND media_type = 'image' AND status = 'aprovada'
      ORDER BY favorite DESC LIMIT 4`,
    [ids],
  );
  const out: InputImage[] = [];
  for (const r of rows) {
    if (!VISION_MIMES.has(r.mime_type) || r.mime_type === "image/gif") continue;
    const data = await storage().get(r.file_key);
    if (data) out.push({ mime: r.mime_type, data });
  }
  return out;
}
