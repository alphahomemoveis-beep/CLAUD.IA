import type { PlanData, Research } from "../ai/schemas";
import type { Source } from "../ai/types";
import { detectEnvironments, mixesEnvironments } from "./environments";

/**
 * Regras do estúdio verificadas em código puro, sem banco nem IA.
 */

/** Tendência sem fonte recente vira referência histórica. */
export function enforceResearchHonesty(r: Research, sources: Source[]): Research {
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  const citedHosts = new Set(sources.map((s) => host(s.url)).filter(Boolean));
  const keep: Research["tendencias_atuais"] = [];
  const moved: Research["referencias_historicas"] = [];
  for (const t of r.tendencias_atuais) {
    // Só conta como tendência atual se a fonte foi citada de fato pela busca na web.
    const h = t.fonte_url ? host(t.fonte_url) : null;
    const hasSource = !!h && citedHosts.has(h);
    if (hasSource) keep.push(t);
    else moved.push({ titulo: t.titulo, descricao: t.descricao, por_que_ainda_importa: "Sem fonte recente confirmada na pesquisa." });
  }
  return { ...r, tendencias_atuais: keep, referencias_historicas: [...r.referencias_historicas, ...moved] };
}

/** Problemas verificáveis no código, antes de mostrar o plano. */
export function planProblems(plan: PlanData, tipo: string, multi: boolean): string[] {
  const p: string[] = [];
  if (!multi && mixesEnvironments(plan.ambiente)) p.push(`O ambiente "${plan.ambiente}" mistura ambientes; deixe um só.`);
  if (tipo === "carrossel" && plan.pecas.length < 3) p.push("Carrossel precisa de pelo menos 3 slides.");
  if (tipo === "reels" && !plan.roteiro) p.push("Reels precisa do roteiro preenchido.");
  if (!multi) {
    const main = detectEnvironments(plan.ambiente)[0];
    const strays = plan.pecas.filter((s) => detectEnvironments(s.descricao_visual).some((e) => main && e !== main));
    if (strays.length) p.push(`As peças ${strays.map((s) => s.numero).join(", ")} mostram outro ambiente além de ${main}.`);
  }
  return p;
}

