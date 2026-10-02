import "server-only";
import { query, queryOne, type Db } from "../db";
import type { Briefing, ConceptData, PlanData, Research, ChecklistItem } from "../ai/schemas";
import type { Stage } from "../studio/workflow";
import type { Source } from "../ai/types";

export interface Conversation {
  id: string;
  brand_id: string;
  user_id: string | null;
  title: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  kind: string;
  content: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface Project {
  id: string;
  brand_id: string;
  conversation_id: string | null;
  title: string;
  content_type: Briefing["tipo"];
  stage: Stage;
  status: "em_desenvolvimento" | "em_revisao" | "concluido" | "arquivado";
  briefing: Briefing;
  research: (Research & { fontes: Source[]; pesquisado_em: string; disponivel: boolean }) | null;
  chosen_concept_id: string | null;
  current_version: number;
  multi_environment: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConceptRow {
  id: string;
  project_id: string;
  round: number;
  number: number;
  title: string;
  environment: string;
  data: ConceptData;
  reference_ids: string[];
  chosen: boolean;
  created_at: string;
}

export interface PlanRow {
  id: string;
  project_id: string;
  concept_id: string;
  version: number;
  data: PlanData;
  reference_ids: string[];
  approved: boolean;
  approved_at: string | null;
  created_at: string;
}

export interface QualityReview {
  attempts: number;
  passed: boolean;
  checklist: ChecklistItem[];
  history: Array<{ attempt: number; failed: string[] }>;
  texto_exato_na_imagem?: string | null;
  resumo_da_mudanca?: string;
}

export interface ImageRow {
  id: string;
  project_id: string;
  plan_id: string;
  slide_number: number;
  slide_role: string;
  version: number;
  prompt: string;
  quality_review: QualityReview | null;
  status: "pendente" | "gerando" | "pronta" | "falhou";
  error: string | null;
  provider: string | null;
  model: string | null;
  size: string | null;
  file_key: string | null;
  revision_of: string | null;
  verdict: "aprovada" | "rejeitada" | "alteracao" | null;
  favorite: boolean;
  created_at: string;
  generated_at: string | null;
}

// Conversas ------------------------------------------------------------------
export const getConversation = (id: string, brandId: string, kind: "estudio" | "agenda" = "estudio") =>
  queryOne<Conversation>(`SELECT * FROM conversations WHERE id = $1 AND brand_id = $2 AND kind = $3`, [id, brandId, kind]);

export const createConversation = (brandId: string, userId: string, kind: "estudio" | "agenda" = "estudio") =>
  queryOne<Conversation>(`INSERT INTO conversations (brand_id, user_id, kind) VALUES ($1,$2,$3) RETURNING *`, [brandId, userId, kind]) as Promise<Conversation>;

export const listMessages = (conversationId: string) =>
  query<Message>(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at, id`, [conversationId]);

export async function addMessage(
  conversationId: string, role: Message["role"], kind: string, content: string, payload?: Record<string, unknown> | null,
): Promise<Message> {
  const row = await queryOne<Message>(
    `INSERT INTO messages (conversation_id, role, kind, content, payload) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [conversationId, role, kind, content, payload ? JSON.stringify(payload) : null],
  );
  await query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [conversationId]);
  return row!;
}

// Projetos -------------------------------------------------------------------
export const getProject = (id: string, brandId: string) =>
  queryOne<Project>(`SELECT * FROM creative_projects WHERE id = $1 AND brand_id = $2`, [id, brandId]);

export const getProjectByConversation = (conversationId: string) =>
  queryOne<Project>(`SELECT * FROM creative_projects WHERE conversation_id = $1`, [conversationId]);

export async function updateProject(id: string, patch: Partial<Omit<Project, "id" | "brand_id">>, db?: Db) {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    values.push(v !== null && typeof v === "object" ? JSON.stringify(v) : v);
    fields.push(`${k} = $${values.length}`);
  }
  values.push(id);
  const sql = `UPDATE creative_projects SET ${fields.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING *`;
  const res = db ? (await db.query(sql, values)).rows : await query(sql, values);
  return res[0] as Project;
}

// Conceitos ------------------------------------------------------------------
export const listConcepts = (projectId: string) =>
  query<ConceptRow>(`SELECT * FROM concepts WHERE project_id = $1 ORDER BY round, number`, [projectId]);

export const getConcept = (id: string, projectId: string) =>
  queryOne<ConceptRow>(`SELECT * FROM concepts WHERE id = $1 AND project_id = $2`, [id, projectId]);

export async function latestConceptRound(projectId: string) {
  const r = await queryOne<{ round: number }>(`SELECT COALESCE(MAX(round), 0) AS round FROM concepts WHERE project_id = $1`, [projectId]);
  return r?.round ?? 0;
}

// Planos ---------------------------------------------------------------------
export const listPlans = (projectId: string) =>
  query<PlanRow>(`SELECT * FROM creative_plans WHERE project_id = $1 ORDER BY version`, [projectId]);

export const latestPlan = (projectId: string) =>
  queryOne<PlanRow>(`SELECT * FROM creative_plans WHERE project_id = $1 ORDER BY version DESC LIMIT 1`, [projectId]);

export const approvedPlan = (projectId: string) =>
  queryOne<PlanRow>(`SELECT * FROM creative_plans WHERE project_id = $1 AND approved ORDER BY version DESC LIMIT 1`, [projectId]);

// Imagens --------------------------------------------------------------------
export const listImages = (projectId: string) =>
  query<ImageRow>(`SELECT * FROM generated_images WHERE project_id = $1 ORDER BY version, slide_number`, [projectId]);

export const getImage = (id: string, brandId: string) =>
  queryOne<ImageRow>(
    `SELECT g.* FROM generated_images g JOIN creative_projects p ON p.id = g.project_id WHERE g.id = $1 AND p.brand_id = $2`,
    [id, brandId],
  );

export const getImagesByIds = (ids: string[]) =>
  query<ImageRow>(`SELECT * FROM generated_images WHERE id = ANY($1::uuid[]) ORDER BY slide_number`, [ids]);
