import "server-only";
import { query } from "../db";
import type { Brand } from "../repo/brand";
import { STUDIO_RULES } from "./rules";

export interface ActivePrompt {
  title: string;
  version: number;
  content: string;
}

export async function activeMasterPrompts(brandId: string): Promise<ActivePrompt[]> {
  return query<ActivePrompt>(
    `SELECT m.title, v.version, v.content FROM master_prompts m
       JOIN prompt_versions v ON v.master_prompt_id = m.id AND v.is_active
      WHERE m.brand_id = $1 AND m.enabled ORDER BY m.sort_order, m.created_at`,
    [brandId],
  );
}

export async function activePreferences(brandId: string, projectId?: string | null) {
  return query<{ kind: string; rule: string; scope: string }>(
    `SELECT kind, rule, scope FROM brand_preferences
      WHERE brand_id = $1 AND active AND (scope = 'marca' OR project_id = $2)
      ORDER BY scope DESC, created_at DESC LIMIT 60`,
    [brandId, projectId ?? null],
  );
}

async function projectHistory(brandId: string, excludeId?: string | null) {
  return query<{ title: string; content_type: string; status: string; concept: string | null; aprovadas: number; rejeitadas: number }>(
    `SELECT p.title, p.content_type, p.status, c.title AS concept,
            COUNT(g.*) FILTER (WHERE g.verdict = 'aprovada')::int AS aprovadas,
            COUNT(g.*) FILTER (WHERE g.verdict = 'rejeitada')::int AS rejeitadas
       FROM creative_projects p
       LEFT JOIN concepts c ON c.id = p.chosen_concept_id
       LEFT JOIN generated_images g ON g.project_id = p.id
      WHERE p.brand_id = $1 AND ($2::uuid IS NULL OR p.id <> $2) AND p.status <> 'arquivado'
      GROUP BY p.id, c.title ORDER BY p.updated_at DESC LIMIT 8`,
    [brandId, excludeId ?? null],
  );
}

/**
 * Memória da marca que acompanha toda conversa, inclusive um chat novo:
 * regras do estúdio, identidade, Prompt Mestre ativo, preferências aprendidas
 * e histórico de projetos. A conversa anterior não entra.
 */
export async function buildBrandMemory(brand: Brand, projectId?: string | null): Promise<string> {
  const [prompts, prefs, history] = await Promise.all([
    activeMasterPrompts(brand.id),
    activePreferences(brand.id, projectId),
    projectHistory(brand.id, projectId),
  ]);
  const id = brand.identity ?? {};
  const sections = [
    STUDIO_RULES,
    `## IDENTIDADE DA MARCA
Nome: ${brand.name}
Posicionamento: ${brand.positioning}
${id.atributos ? `A identidade deve transmitir: ${id.atributos}` : ""}
${id.tom_de_voz ? `Tom de voz: ${id.tom_de_voz}` : ""}
${id.publico ? `Público: ${id.publico}` : ""}
${id.instagram ? `Instagram: ${id.instagram}` : ""}
${id.cores_marca?.length ? `Cores da marca: ${id.cores_marca.join(", ")}` : ""}
${id.logo_regras ? `Logo: ${id.logo_regras}` : ""}
${id.assinatura_regras ? `Assinatura: ${id.assinatura_regras}` : ""}
${id.assinatura_fantasma ? `Assinatura fantasma permitida: "${id.assinatura_fantasma_texto || brand.name}" transparente, integrada ao cenário.` : ""}
${id.evitar ? `Evitar sempre: ${id.evitar}` : ""}`.replace(/\n{2,}/g, "\n"),
    prompts.length
      ? `## PROMPT MESTRE (versões ativas)\n${prompts.map((p) => `### ${p.title} (v${p.version})\n${p.content}`).join("\n\n")}`
      : "## PROMPT MESTRE\nNenhum Prompt Mestre ativo.",
    prefs.length
      ? `## PREFERÊNCIAS APRENDIDAS COM O FEEDBACK\n${prefs.map((p) => `- [${p.kind.toUpperCase()}${p.scope === "projeto" ? ", só neste projeto" : ""}] ${p.rule}`).join("\n")}`
      : "",
    history.length
      ? `## HISTÓRICO RECENTE DE PROJETOS\n${history.map((h) => `- ${h.title} (${h.content_type}, ${h.status})${h.concept ? `: conceito "${h.concept}"` : ""}; ${h.aprovadas} aprovadas, ${h.rejeitadas} rejeitadas`).join("\n")}`
      : "",
  ];
  return sections.filter(Boolean).join("\n\n");
}
