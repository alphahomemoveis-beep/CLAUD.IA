import "server-only";
import { text as llm } from "../ai";
import { FeedbackLessonSchema, RevisedPromptSchema } from "../ai/schemas";
import { query, queryOne, tx } from "../db";
import { effectiveAI, getBrand } from "../repo/brand";
import { addMessage, getImage, type ImageRow, type PlanRow, type Project, type QualityReview } from "../repo/projects";
import { buildBrandMemory } from "./context";
import { dataBlock } from "./rules";
import { WorkflowError } from "./workflow";
import { logActivity } from "../activity";
import { log } from "../logger";

export type FeedbackKind = "aprovar" | "rejeitar" | "favoritar" | "alterar";

export interface FeedbackInput {
  imageId: string;
  kind: FeedbackKind;
  comment?: string;
  /** Onde guardar o aprendizado: na marca inteira ou só neste projeto. */
  scope?: "marca" | "projeto";
  learn?: boolean;
}

export interface FeedbackResult {
  image: ImageRow;
  lessons: Array<{ id: string; kind: string; rule: string; scope: string }>;
  revision: ImageRow | null;
}

/**
 * Registra o feedback de uma peça e transforma o comentário em preferência
 * reaplicável. Pedido de alteração cria uma nova versão da peça.
 */
export async function giveFeedback(userId: string, input: FeedbackInput): Promise<FeedbackResult> {
  const brand = await getBrand();
  const cfg = effectiveAI(brand);
  const image = await getImage(input.imageId, brand.id);
  if (!image) throw new WorkflowError("Peça não encontrada.");
  if (image.status !== "pronta" && input.kind !== "alterar") throw new WorkflowError("A peça ainda não foi gerada.");
  const project = (await queryOne<Project>(`SELECT * FROM creative_projects WHERE id = $1`, [image.project_id]))!;
  const comment = (input.comment ?? "").trim().slice(0, 2000);

  const fb = (await queryOne<{ id: string }>(
    `INSERT INTO feedback (project_id, image_id, plan_id, user_id, kind, comment) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [project.id, image.id, image.plan_id, userId, input.kind, comment],
  ))!;

  let updated: ImageRow;
  if (input.kind === "favoritar") {
    updated = (await queryOne<ImageRow>(`UPDATE generated_images SET favorite = NOT favorite WHERE id = $1 RETURNING *`, [image.id]))!;
  } else {
    const verdict = { aprovar: "aprovada", rejeitar: "rejeitada", alterar: "alteracao" }[input.kind];
    updated = (await queryOne<ImageRow>(`UPDATE generated_images SET verdict = $1 WHERE id = $2 RETURNING *`, [verdict, image.id]))!;
  }
  await refreshProjectStatus(project.id);
  await logActivity(userId, `feedback_${input.kind}`, "generated_images", image.id, { comentario: comment.slice(0, 200) });

  // Aprendizado: comentário de rejeição ou alteração vira preferência.
  const lessons: FeedbackResult["lessons"] = [];
  if (comment && input.learn !== false && (input.kind === "rejeitar" || input.kind === "alterar" || input.kind === "aprovar")) {
    try {
      const { data } = await llm().structured({
        schemaName: "licao_feedback",
        schema: FeedbackLessonSchema,
        model: cfg.textModel,
        system: `Transforme o feedback da marca ${brand.name} sobre uma peça criada em regras curtas e reaplicáveis para as próximas criações.
Uma regra por ideia, no imperativo. Se o feedback for específico demais desta peça, não crie regra.
${input.kind === "aprovar" ? "Feedback positivo vira regra do tipo 'preferir'." : ""}`,
        messages: [{ role: "user", text: `Feedback (${input.kind}):\n${dataBlock({ comentario: comment, peca: image.slide_role, prompt: image.prompt.slice(0, 1500) })}` }],
      });
      const scope = input.scope ?? "marca";
      for (const r of data.regras.slice(0, 4)) {
        const row = (await queryOne<{ id: string; kind: string; rule: string; scope: string }>(
          `INSERT INTO brand_preferences (brand_id, project_id, scope, kind, rule, source, source_feedback_id, created_by)
           VALUES ($1,$2,$3,$4,$5,'feedback',$6,$7) RETURNING id, kind, rule, scope`,
          [brand.id, scope === "projeto" ? project.id : null, scope, r.tipo, r.regra.slice(0, 500), fb.id, userId],
        ))!;
        lessons.push(row);
      }
    } catch (err) {
      log.warn("licao_feedback_falhou", { err });
    }
  }

  let revision: ImageRow | null = null;
  if (input.kind === "alterar") {
    if (!comment) throw new WorkflowError("Diga o que precisa mudar para eu criar a nova versão.");
    revision = await createRevision(project, image, comment, cfg.textModel);
    if (project.conversation_id) {
      await addMessage(project.conversation_id, "user", "text", `Alteração na peça ${String(image.slide_number).padStart(2, "0")}: ${comment}`);
      await addMessage(project.conversation_id, "assistant", "generation",
        `Nova versão da peça ${String(image.slide_number).padStart(2, "0")} (v${String(revision.version).padStart(2, "0")}). ${revision.quality_review?.resumo_da_mudanca ?? ""}`.trim(),
        { version: revision.version, imageIds: [revision.id] });
    }
  }
  return { image: updated, lessons, revision };
}

async function createRevision(project: Project, image: ImageRow, request: string, model: string): Promise<ImageRow> {
  const brand = await getBrand();
  const plan = (await queryOne<PlanRow>(`SELECT * FROM creative_plans WHERE id = $1`, [image.plan_id]))!;
  if (!plan.approved) throw new WorkflowError("Regra absoluta: a peça só é alterada sobre um planejamento aprovado.");
  const memory = await buildBrandMemory(brand, project.id);
  const piece = plan.data.pecas.find((p) => p.numero === image.slide_number);
  const { data } = await llm().structured({
    schemaName: "revisao_peca",
    schema: RevisedPromptSchema,
    model,
    system: `${memory}\n\n## TAREFA\nReescreva o prompt final de UMA peça aplicando o pedido de alteração, sem sair do planejamento aprovado
nem do ambiente principal "${plan.data.ambiente}". Depois avalie no checklist de qualidade.`,
    messages: [{ role: "user", text: dataBlock({ peca: piece, prompt_anterior: image.prompt, pedido: request }) }],
  });

  return tx(async (db) => {
    const v = (await db.query<{ v: number }>(`SELECT current_version + 1 AS v FROM creative_projects WHERE id = $1 FOR UPDATE`, [project.id])).rows[0].v;
    const review: QualityReview = {
      attempts: 1,
      passed: data.checklist.every((c) => c.aprovado),
      checklist: data.checklist,
      history: [{ attempt: 1, failed: data.checklist.filter((c) => !c.aprovado).map((c) => c.item) }],
      texto_exato_na_imagem: data.texto_exato_na_imagem,
      resumo_da_mudanca: data.resumo_da_mudanca,
    };
    const res = await db.query<ImageRow>(
      `INSERT INTO generated_images (project_id, plan_id, slide_number, slide_role, version, prompt, quality_review, revision_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [project.id, plan.id, image.slide_number, image.slide_role, v, data.prompt_final, JSON.stringify(review), image.id],
    );
    await db.query(`UPDATE creative_projects SET current_version = $1, status = 'em_revisao', updated_at = now() WHERE id = $2`, [v, project.id]);
    return res.rows[0];
  });
}

/** Concluído quando a versão mais recente de cada peça está aprovada. */
async function refreshProjectStatus(projectId: string) {
  const rows = await query<{ verdict: string | null }>(
    `SELECT DISTINCT ON (slide_number) verdict FROM generated_images
      WHERE project_id = $1 ORDER BY slide_number, version DESC`,
    [projectId],
  );
  const status = rows.length && rows.every((r) => r.verdict === "aprovada")
    ? "concluido"
    : rows.some((r) => r.verdict === "rejeitada" || r.verdict === "alteracao") ? "em_revisao" : "em_desenvolvimento";
  await query(`UPDATE creative_projects SET status = $1, updated_at = now() WHERE id = $2 AND status <> 'arquivado'`, [status, projectId]);
}
