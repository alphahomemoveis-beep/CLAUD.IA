import { z } from "zod";
import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getProject, listConcepts, listPlans, listMessages } from "@/lib/repo/projects";
import { loadImagesForMessages } from "@/lib/studio/views";

type P = { id: string };

/** Tudo o que o projeto guarda: briefing, conceitos, planos, prompts, imagens, versões, feedback e referências. */
export const GET = route<P>(async ({ params }) => {
  const brand = await getBrand();
  const project = await getProject(params.id, brand.id);
  if (!project) throw notFound("Projeto não encontrado.");
  const [concepts, plans, images, feedback, messages] = await Promise.all([
    listConcepts(project.id),
    listPlans(project.id),
    loadImagesForMessages(project.id),
    query(`SELECT f.*, u.name AS user_name FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.project_id = $1 ORDER BY f.created_at DESC`, [project.id]),
    project.conversation_id ? listMessages(project.conversation_id) : Promise.resolve([]),
  ]);
  const refIds = [...new Set([...plans.flatMap((p) => p.reference_ids), ...concepts.flatMap((c) => c.reference_ids)])];
  const references = refIds.length
    ? await query(`SELECT id, name, category, status, favorite, media_type FROM visual_references WHERE id = ANY($1::uuid[])`, [refIds])
    : [];
  const preferences = await query(`SELECT id, kind, rule, scope, active, created_at FROM brand_preferences WHERE project_id = $1 ORDER BY created_at DESC`, [project.id]);
  return json({ project, concepts, plans, images, feedback, references, preferences, messageCount: messages.length });
});

const Patch = z.object({
  title: z.string().min(1).max(120).optional(),
  status: z.enum(["em_desenvolvimento", "em_revisao", "concluido", "arquivado"]).optional(),
});

export const PATCH = route<P>(async ({ params, req }) => {
  const brand = await getBrand();
  const project = await getProject(params.id, brand.id);
  if (!project) throw notFound("Projeto não encontrado.");
  const body = Patch.parse(await req.json());
  const rows = await query(
    `UPDATE creative_projects SET title = COALESCE($1, title), status = COALESCE($2, status), updated_at = now() WHERE id = $3 RETURNING *`,
    [body.title ?? null, body.status ?? null, project.id],
  );
  return json({ project: rows[0] });
}, { role: "editor" });
