import "server-only";
import { images, text as llm } from "../ai";
import {
  AnswerSchema, BriefingSchema, ConceptSetSchema, FinalPromptsSchema, PlanSchema, ReplyIntentSchema, ResearchSchema,
  type Briefing, type ChecklistItem, type ConceptData, type PlanData,
} from "../ai/schemas";
import type { ChatTurn } from "../ai/types";
import { query, queryOne, tx } from "../db";
import { log } from "../logger";
import { effectiveAI, getBrand, type Brand, type EffectiveAI } from "../repo/brand";
import {
  addMessage, approvedPlan, getConcept, getProjectByConversation, latestConceptRound, latestPlan, listMessages,
  updateProject, type ConceptRow, type Message, type PlanRow, type Project, type QualityReview,
} from "../repo/projects";
import { buildBrandMemory } from "./context";
import { mixesEnvironments } from "./environments";
import { parseReply } from "./intent";
import { formatReferences, rejectedSignals, retrieveReferences, type RetrievedReference } from "./retrieval";
import { CONTENT_TYPE_LABEL, dataBlock } from "./rules";
import { assertCanApprovePlan, assertCanChooseConcept, WorkflowError } from "./workflow";
import { enforceResearchHonesty, planProblems } from "./guards";
import { logActivity } from "../activity";

export type StudioAction =
  | { type: "message"; text: string }
  | { type: "choose_concept"; conceptId: string }
  | { type: "approve_plan"; planId: string }
  | { type: "revise_plan"; notes: string }
  | { type: "regenerate_concepts"; notes: string };

interface Ctx {
  brand: Brand;
  cfg: EffectiveAI;
  userId: string;
  conversationId: string;
}

const MAX_QUALITY_REVISIONS = 2;

/** Ponto de entrada do chat: recebe a ação e devolve as mensagens novas. */
export async function handleAction(userId: string, conversationId: string, action: StudioAction): Promise<Message[]> {
  const brand = await getBrand();
  const ctx: Ctx = { brand, cfg: effectiveAI(brand), userId, conversationId };
  const project = await getProjectByConversation(conversationId);
  const out: Message[] = [];

  switch (action.type) {
    case "message": {
      out.push(await addMessage(conversationId, "user", "text", action.text));
      out.push(...(await routeMessage(ctx, project, action.text)));
      break;
    }
    case "choose_concept": {
      if (!project) throw new WorkflowError("Esta conversa ainda não tem projeto.");
      const concept = await getConcept(action.conceptId, project.id);
      if (!concept) throw new WorkflowError("Conceito não encontrado neste projeto.");
      out.push(await addMessage(conversationId, "user", "text", `Conceito ${pad(concept.number)}.`));
      out.push(...(await chooseConcept(ctx, project, concept)));
      break;
    }
    case "approve_plan": {
      if (!project) throw new WorkflowError("Esta conversa ainda não tem projeto.");
      out.push(await addMessage(conversationId, "user", "text", "Aprovar planejamento."));
      out.push(...(await approvePlan(ctx, project, action.planId)));
      break;
    }
    case "revise_plan": {
      if (!project) throw new WorkflowError("Esta conversa ainda não tem projeto.");
      out.push(await addMessage(conversationId, "user", "text", action.notes));
      out.push(...(await revisePlan(ctx, project, action.notes)));
      break;
    }
    case "regenerate_concepts": {
      if (!project) throw new WorkflowError("Esta conversa ainda não tem projeto.");
      out.push(await addMessage(conversationId, "user", "text", action.notes || "Quero outros conceitos."));
      out.push(...(await presentConcepts(ctx, project, action.notes)));
      break;
    }
  }
  return out;
}

async function routeMessage(ctx: Ctx, project: Project | null, text: string): Promise<Message[]> {
  if (!project) return startProject(ctx, text);

  const quick = parseReply(text);
  if (project.stage === "conceitos" || project.stage === "planejamento") {
    if (quick.kind === "choose") {
      const concept = await conceptByNumber(project.id, quick.number);
      if (concept) return chooseConcept(ctx, project, concept);
    }
    if (quick.kind === "approve" && project.stage === "planejamento") {
      const plan = await latestPlan(project.id);
      if (plan && !plan.approved) return approvePlan(ctx, project, plan.id);
    }
  }

  const intent = await interpretReply(ctx, project, text);
  switch (intent.acao) {
    case "escolher_conceito": {
      const concept = intent.numero_conceito ? await conceptByNumber(project.id, intent.numero_conceito) : null;
      if (concept && (project.stage === "conceitos" || project.stage === "planejamento")) return chooseConcept(ctx, project, concept);
      return [await say(ctx, "Não encontrei esse conceito. Escolha um dos conceitos apresentados pelo número, por exemplo \"Conceito 2\".")];
    }
    case "aprovar_planejamento": {
      const plan = await latestPlan(project.id);
      if (project.stage === "planejamento" && plan && !plan.approved) return approvePlan(ctx, project, plan.id);
      return [await say(ctx, project.stage === "conceitos"
        ? "Antes de aprovar, escolha um conceito. Só então eu monto o planejamento."
        : "Não há planejamento aguardando aprovação agora.")];
    }
    case "alterar": {
      if (project.stage === "conceitos" || project.stage === "briefing") return presentConcepts(ctx, project, intent.observacoes || text);
      return revisePlan(ctx, project, intent.observacoes || text);
    }
    case "novo_pedido":
      return [await say(ctx, `Este chat já tem o projeto "${project.title}" em andamento. Para outro pedido, use ＋ Novo chat: a memória da marca continua lá. Se quiser mudar a direção deste projeto, diga o que mudar.`)];
    case "pergunta":
    default:
      return [await answer(ctx, project, text)];
  }
}

// 1. Pedido > análise > pesquisa > referências > conceitos ------------------------
async function startProject(ctx: Ctx, text: string): Promise<Message[]> {
  const memory = await buildBrandMemory(ctx.brand, null);
  const history = await chatHistory(ctx.conversationId);
  const { data: briefing } = await llm().structured({
    schemaName: "briefing",
    schema: BriefingSchema,
    model: ctx.cfg.textModel,
    system: `${memory}\n\n## TAREFA\nAnalise o pedido e identifique tipo, tema, público, objetivo, ambiente e estética. Não crie conceitos ainda.`,
    messages: [...history, { role: "user", text: `PEDIDO: ${text}` }],
  });

  if (!briefing.eh_pedido_criativo) {
    return [await say(ctx, briefing.resposta_direta || "Diga o que você quer criar, por exemplo: \"Crie um carrossel sobre cozinhas pequenas\".")];
  }

  const project = await tx(async (db) => {
    const res = await db.query<Project>(
      `INSERT INTO creative_projects (brand_id, conversation_id, title, content_type, stage, briefing, multi_environment, created_by)
       VALUES ($1,$2,$3,$4,'briefing',$5,$6,$7) RETURNING *`,
      [ctx.brand.id, ctx.conversationId, briefing.titulo_projeto.slice(0, 120), briefing.tipo, JSON.stringify(briefing),
       briefing.multiplos_ambientes_solicitados, ctx.userId],
    );
    await db.query(`UPDATE conversations SET title = $1 WHERE id = $2`, [briefing.titulo_projeto.slice(0, 120), ctx.conversationId]);
    return res.rows[0];
  });
  await logActivity(ctx.userId, "projeto_criado", "creative_projects", project.id, { tipo: briefing.tipo });

  const out: Message[] = [];
  out.push(await addMessage(ctx.conversationId, "assistant", "briefing", briefingSummary(briefing), { briefing }));

  const research = await runResearch(ctx, briefing);
  const withResearch = await updateProject(project.id, { research });
  out.push(await addMessage(ctx.conversationId, "assistant", "research", researchSummary(research), { research }));

  out.push(...(await presentConcepts(ctx, withResearch, null)));
  return out;
}

export async function runResearch(ctx: Ctx, briefing: Briefing): Promise<NonNullable<Project["research"]>> {
  const pesquisado_em = new Date().toISOString();
  const empty = (resumo: string): NonNullable<Project["research"]> => ({
    resumo, tendencias_atuais: [], referencias_historicas: [], formatos_em_alta: [], oportunidades_para_marca: [],
    cuidados: [], fontes: [], pesquisado_em, disponivel: false,
  });
  if (!ctx.cfg.webSearch) return empty("Pesquisa de mercado desligada nas configurações. Os conceitos usam só a memória da marca.");
  try {
    const today = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const { data, sources } = await llm().structured({
      schemaName: "pesquisa",
      schema: ResearchSchema,
      model: ctx.cfg.textModel,
      webSearch: true,
      system: `Você é um pesquisador de mercado de interiores e marcenaria de alto padrão no Brasil. Hoje é ${today}.
Pesquise na web referências RECENTES (últimos 12 meses) sobre: Instagram, arquitetura, interiores, móveis planejados,
decoração, campanhas premium, concorrentes e formatos de conteúdo.
Regras:
- Em tendencias_atuais coloque só o que você encontrou nesta pesquisa, com fonte_url e data.
- Linguagem consolidada ou conhecimento antigo vai em referencias_historicas, nunca como tendência atual.
- Se não encontrar nada recente, deixe tendencias_atuais vazia e diga isso no resumo.`,
      messages: [{ role: "user", text: `Pesquise para este briefing:\n${dataBlock({ tipo: briefing.tipo, tema: briefing.tema, ambiente: briefing.ambiente, temas: briefing.temas_pesquisa })}` }],
    });
    return { ...enforceResearchHonesty(data, sources), fontes: sources, pesquisado_em, disponivel: ctx.cfg.provider !== "mock" && sources.length > 0 };
  } catch (err) {
    log.warn("pesquisa_falhou", { err });
    return empty("A pesquisa na web falhou agora. Os conceitos usam só a memória da marca, sem tendências atuais.");
  }
}

async function presentConcepts(ctx: Ctx, project: Project, notes: string | null): Promise<Message[]> {
  if (project.stage === "aprovado" || project.stage === "gerado") {
    throw new WorkflowError("O planejamento já foi aprovado. Peça uma alteração no planejamento ou nas imagens.");
  }
  const briefing = project.briefing;
  const refs = await retrieveReferences(ctx.brand.id, [briefing.consulta_referencias, briefing.tema, briefing.ambiente].join(". "), ctx.cfg);
  const avoid = await rejectedSignals(ctx.brand.id);
  const memory = await buildBrandMemory(ctx.brand, project.id);
  const round = (await latestConceptRound(project.id)) + 1;
  const previous = round > 1
    ? await query<{ title: string; environment: string }>(`SELECT title, environment FROM concepts WHERE project_id = $1`, [project.id])
    : [];

  const system = `${memory}

## REFERÊNCIAS RECUPERADAS DA BIBLIOTECA
${formatReferences(refs)}
${avoid.length ? `\n## REFERÊNCIAS REJEITADAS (evite esta linguagem)\n${avoid.map((a) => `- ${a}`).join("\n")}` : ""}

## TAREFA
Proponha exatamente ${ctx.cfg.conceptCount} conceitos para o pedido. NÃO gere imagem e não escreva prompt de imagem.
Cada conceito tem UM ambiente principal${project.multi_environment ? " (a pessoa pediu vários ambientes, então pode combinar)" : ""}.
Use as referências pelo ID em referencias_ids quando fizerem sentido.
${project.research?.disponivel ? "Use as tendências atuais da pesquisa quando ajudarem, citando que são atuais." : "Não há pesquisa atual disponível: não fale em tendência atual."}`;

  const input = {
    briefing,
    pesquisa: project.research ? { resumo: project.research.resumo, tendencias_atuais: project.research.tendencias_atuais, referencias_historicas: project.research.referencias_historicas } : null,
    referencias: refs.map((r) => ({ id: r.id, nome: r.name })),
    quantidade: ctx.cfg.conceptCount,
    conceitos_anteriores: previous.map((p) => `${p.title} (${p.environment})`),
    ajustes: notes,
  };
  const prompt = `${notes ? `A pessoa pediu novos conceitos com este ajuste: ${notes}\n` : ""}Crie os conceitos.\n${dataBlock(input)}`;

  let set = (await llm().structured({ schemaName: "conceitos", schema: ConceptSetSchema, model: ctx.cfg.textModel, system, messages: [{ role: "user", text: prompt }] })).data;

  // Regra de um ambiente por arte, verificada no código.
  const mixed = set.conceitos.filter((c) => !project.multi_environment && mixesEnvironments(c.ambiente));
  if (mixed.length) {
    log.info("conceito_com_varios_ambientes", { project: project.id, conceitos: mixed.map((c) => c.numero) });
    set = (await llm().structured({
      schemaName: "conceitos", schema: ConceptSetSchema, model: ctx.cfg.textModel, system,
      messages: [{ role: "user", text: `${prompt}\n\nATENÇÃO: os conceitos ${mixed.map((c) => c.numero).join(", ")} misturaram ambientes. Refaça com UM ambiente principal por conceito.` }],
    })).data;
  }

  const validRefIds = new Set(refs.map((r) => r.id));
  const saved = await tx(async (db) => {
    const rows: ConceptRow[] = [];
    for (const [i, c] of set.conceitos.entries()) {
      const concept: ConceptData = { ...c, numero: i + 1, referencias_ids: c.referencias_ids.filter((id) => validRefIds.has(id)) };
      const res = await db.query<ConceptRow>(
        `INSERT INTO concepts (project_id, round, number, title, environment, data, reference_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [project.id, round, i + 1, concept.titulo, concept.ambiente, JSON.stringify(concept), concept.referencias_ids],
      );
      rows.push(res.rows[0]);
    }
    await db.query(`UPDATE creative_projects SET stage = 'conceitos', chosen_concept_id = NULL, updated_at = now() WHERE id = $1`, [project.id]);
    return rows;
  });

  const refMsg = await addMessage(ctx.conversationId, "assistant", "references",
    refs.length ? `Consultei ${refs.length} referências da biblioteca.` : "A biblioteca ainda não tem referências aprovadas para este tema.",
    { references: refs.map(publicRef) });

  const conceptsMsg = await addMessage(
    ctx.conversationId, "assistant", "concepts",
    `💡 CONCEITOS DISPONÍVEIS\n${saved.map((c) => `CONCEITO ${pad(c.number)} — "${c.title}" (${c.environment})`).join("\n")}\nEscolha um conceito para eu montar o planejamento.`,
    { round, introducao: set.introducao, recomendacao: set.recomendacao, concepts: saved.map((c) => ({ id: c.id, ...c.data })) },
  );
  return [refMsg, conceptsMsg];
}

// 2. Conceito escolhido > planejamento ------------------------------------------
async function chooseConcept(ctx: Ctx, project: Project, concept: ConceptRow): Promise<Message[]> {
  assertCanChooseConcept({ stage: project.stage, chosenConceptId: project.chosen_concept_id, approvedPlanId: null });
  await tx(async (db) => {
    await db.query(`UPDATE concepts SET chosen = (id = $1) WHERE project_id = $2`, [concept.id, project.id]);
    await db.query(`UPDATE creative_projects SET chosen_concept_id = $1, updated_at = now() WHERE id = $2`, [concept.id, project.id]);
  });
  const fresh = { ...project, chosen_concept_id: concept.id };
  return [await createPlan(ctx, fresh, concept, null)];
}

async function createPlan(ctx: Ctx, project: Project, concept: ConceptRow, notes: string | null, previous?: PlanRow | null): Promise<Message> {
  const refs = await plannedReferences(ctx, project, concept);
  const memory = await buildBrandMemory(ctx.brand, project.id);
  const tipo = project.content_type;
  const formatRules: Record<string, string> = {
    carrossel: "Carrossel: de 4 a 7 slides em 4:5 (ex.: GANCHO, PROBLEMA, SOLUÇÃO, EXEMPLO, CTA). Cada slide é uma peça independente. roteiro = null.",
    reels: "Reels: preencha o roteiro com GANCHO, DESENVOLVIMENTO, DEMONSTRACAO, VIRADA e CTA (texto falado, texto na tela, cena, enquadramento, B-roll e duração). Proporção 9:16. Em pecas, só a CAPA do Reels.",
    arte: "Arte: uma única peça 4:5. roteiro = null.",
    imagem: "Imagem: uma única peça, fotografia sem texto ou com texto mínimo. roteiro = null.",
    story: "Story: uma única peça 9:16. roteiro = null.",
  };
  const system = `${memory}

## REFERÊNCIAS PARA ESTE CONCEITO
${formatReferences(refs)}

## TAREFA
Monte o planejamento completo do conceito escolhido. NÃO gere imagem.
${formatRules[tipo]}
O ambiente principal é "${concept.environment}"${project.multi_environment ? "" : " e nenhum outro ambiente pode protagonizar a peça"}.
Em referencias_utilizadas use só IDs da lista acima e diga o que absorver sem copiar.`;

  const input = {
    briefing: project.briefing,
    conceito: concept.data,
    referencias: refs.map((r) => ({ id: r.id, nome: r.name })),
    pesquisa: project.research?.disponivel ? project.research.tendencias_atuais : null,
    planejamento_anterior: previous?.data ?? null,
    ajustes: notes,
  };
  const request = `${notes ? `Revise o planejamento com este pedido: ${notes}\n` : ""}${dataBlock(input)}`;
  let plan = (await llm().structured({ schemaName: "planejamento", schema: PlanSchema, model: ctx.cfg.textModel, system, messages: [{ role: "user", text: request }] })).data;

  const problems = planProblems(plan, tipo, project.multi_environment);
  if (problems.length) {
    plan = (await llm().structured({
      schemaName: "planejamento", schema: PlanSchema, model: ctx.cfg.textModel, system,
      messages: [{ role: "user", text: `${request}\n\nCorrija estes problemas: ${problems.join(" ")}` }],
    })).data;
  }
  plan = normalizePlan(plan, tipo, refs);

  const version = (await queryOne<{ v: number }>(`SELECT COALESCE(MAX(version),0)+1 AS v FROM creative_plans WHERE project_id = $1`, [project.id]))!.v;
  const row = await tx(async (db) => {
    const res = await db.query<PlanRow>(
      `INSERT INTO creative_plans (project_id, concept_id, version, data, reference_ids) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [project.id, concept.id, version, JSON.stringify(plan), plan.referencias_utilizadas.map((r) => r.id)],
    );
    await db.query(`UPDATE creative_projects SET stage = 'planejamento', updated_at = now() WHERE id = $1`, [project.id]);
    return res.rows[0];
  });

  return addMessage(ctx.conversationId, "assistant", "plan", `${planSummary(plan, concept)}\n\nAprovar planejamento?`, {
    planId: row.id, version, conceptNumber: concept.number, conceptTitle: concept.title, contentType: tipo, plan,
  });
}

function normalizePlan(plan: PlanData, tipo: Project["content_type"], refs: RetrievedReference[]): PlanData {
  const valid = new Set(refs.map((r) => r.id));
  let pecas = plan.pecas.map((s, i) => ({ ...s, numero: i + 1 }));
  if (tipo === "arte" || tipo === "imagem" || tipo === "story" || tipo === "reels") pecas = pecas.slice(0, 1);
  const proporcao = tipo === "reels" || tipo === "story" ? "9:16" : plan.proporcao === "9:16" ? "4:5" : plan.proporcao;
  return {
    ...plan,
    pecas,
    proporcao,
    roteiro: tipo === "reels" ? plan.roteiro : null,
    referencias_utilizadas: plan.referencias_utilizadas.filter((r) => valid.has(r.id)),
  };
}

async function plannedReferences(ctx: Ctx, project: Project, concept: ConceptRow) {
  const retrieved = await retrieveReferences(ctx.brand.id, [concept.title, concept.environment, concept.data.paleta, concept.data.protagonista].join(". "), ctx.cfg);
  const chosenIds = concept.reference_ids.filter((id) => !retrieved.some((r) => r.id === id));
  const extra = chosenIds.length
    ? await query<RetrievedReference>(
        `SELECT id, name, category, status, favorite, rating, visual_description, environment, style, palette, materials,
                recommended_use, file_key, mime_type, media_type, analysis, NULL::float AS similarity
           FROM visual_references WHERE id = ANY($1::uuid[]) AND brand_id = $2 AND status <> 'rejeitada'`,
        [chosenIds, ctx.brand.id],
      )
    : [];
  void project;
  return [...extra, ...retrieved].slice(0, ctx.cfg.maxReferences);
}

async function revisePlan(ctx: Ctx, project: Project, notes: string): Promise<Message[]> {
  if (!project.chosen_concept_id) return presentConcepts(ctx, project, notes);
  const concept = await getConcept(project.chosen_concept_id, project.id);
  if (!concept) throw new WorkflowError("Conceito escolhido não encontrado.");
  const previous = await latestPlan(project.id);
  // Pedir alteração depois da aprovação volta o projeto ao planejamento: será preciso aprovar de novo.
  return [await createPlan(ctx, project, concept, notes, previous)];
}

// 3. Aprovação > prompt final + checklist de qualidade ----------------------------
async function approvePlan(ctx: Ctx, project: Project, planId: string): Promise<Message[]> {
  const plan = await latestPlan(project.id);
  assertCanApprovePlan(
    { stage: project.stage, chosenConceptId: project.chosen_concept_id, approvedPlanId: null },
    !!plan && plan.id === planId && !plan.approved,
  );
  await query(`UPDATE creative_plans SET approved = true, approved_at = now(), approved_by = $1 WHERE id = $2`, [ctx.userId, plan!.id]);
  await logActivity(ctx.userId, "planejamento_aprovado", "creative_plans", plan!.id);

  const { pieces, review } = await buildFinalPrompts(ctx, project, plan!);
  const version = project.current_version + 1;
  const imageIds = await tx(async (db) => {
    const ids: string[] = [];
    for (const piece of plan!.data.pecas) {
      const fp = pieces.find((p) => p.numero === piece.numero);
      if (!fp) continue;
      const res = await db.query<{ id: string }>(
        `INSERT INTO generated_images (project_id, plan_id, slide_number, slide_role, version, prompt, quality_review)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [project.id, plan!.id, piece.numero, piece.papel, version, fp.prompt_final,
         JSON.stringify({ ...review, checklist: fp.checklist, texto_exato_na_imagem: fp.texto_exato_na_imagem } satisfies QualityReview)],
      );
      ids.push(res.rows[0].id);
    }
    await db.query(`UPDATE creative_projects SET stage = 'aprovado', current_version = $1, updated_at = now() WHERE id = $2`, [version, project.id]);
    return ids;
  });

  const label = project.content_type === "carrossel" ? `${imageIds.length} slides independentes` : project.content_type === "reels" ? "a capa do Reels" : "a arte";
  const msgs: Message[] = [];
  msgs.push(await addMessage(ctx.conversationId, "assistant", "quality",
    `Planejamento aprovado. Escrevi o prompt final e rodei o checklist de qualidade${review.attempts > 1 ? `, revisando o prompt ${review.attempts - 1} vez(es)` : ""}.`,
    { review, pieces: pieces.map((p) => ({ numero: p.numero, checklist: p.checklist })) }));
  const manual = !images();
  msgs.push(await addMessage(ctx.conversationId, "assistant", "generation",
    manual
      ? `Prompt final pronto para ${label} (v${pad(version)}). Copie o prompt, gere a imagem e envie a peça pronta em cada cartão.`
      : `Gerando ${label} (v${pad(version)}).`,
    { version, imageIds }));
  return msgs;
}

type FinalPiece = { numero: number; prompt_final: string; texto_exato_na_imagem: string | null; checklist: ChecklistItem[] };

async function buildFinalPrompts(ctx: Ctx, project: Project, plan: PlanRow): Promise<{ pieces: FinalPiece[]; review: QualityReview }> {
  const memory = await buildBrandMemory(ctx.brand, project.id);
  const refs = plan.reference_ids.length
    ? await query<RetrievedReference>(
        `SELECT id, name, category, status, favorite, rating, visual_description, environment, style, palette, materials,
                recommended_use, file_key, mime_type, media_type, analysis, NULL::float AS similarity
           FROM visual_references WHERE id = ANY($1::uuid[])`, [plan.reference_ids])
    : [];
  const system = `${memory}

## REFERÊNCIAS DO PLANEJAMENTO APROVADO
${formatReferences(refs)}

## TAREFA
Escreva o prompt final de cada peça para o modelo de geração de imagem.
- Um prompt por peça. Cada peça é uma imagem independente; nunca descreva várias peças numa imagem.
- Prompt em inglês, como direção de fotografia profissional de interiores: ambiente, marcenaria, materiais, luz, lente, enquadramento.
- Inclua o texto exato da arte entre aspas e onde ele fica, a logo e a assinatura conforme o planejamento.
- Depois avalie cada prompt no checklist de qualidade com honestidade. Marque aprovado=false se não atingir o padrão.`;

  const history: QualityReview["history"] = [];
  let messages: ChatTurn[] = [{ role: "user", text: `Planejamento aprovado:\n${dataBlock({ planejamento: plan.data, tipo: project.content_type })}` }];
  let pieces: FinalPiece[] = [];
  let attempts = 0;
  for (; attempts <= MAX_QUALITY_REVISIONS; attempts++) {
    const { data } = await llm().structured({ schemaName: "prompts_finais", schema: FinalPromptsSchema, model: ctx.cfg.textModel, system, messages });
    pieces = data.pecas;
    const failed = pieces.flatMap((p) => p.checklist.filter((c) => !c.aprovado).map((c) => `peça ${p.numero}: ${c.item} (${c.observacao})`));
    const envIssues = project.multi_environment ? [] : pieces.filter((p) => mixesEnvironments(p.prompt_final.replace(/"[^"]*"/g, ""))).map((p) => `peça ${p.numero}: ambiente (o prompt descreve mais de um ambiente)`);
    const allFailed = [...failed, ...envIssues];
    history.push({ attempt: attempts + 1, failed: allFailed });
    if (!allFailed.length) break;
    if (attempts === MAX_QUALITY_REVISIONS) break;
    messages = [...messages, { role: "assistant", text: JSON.stringify(data) }, {
      role: "user", text: `O checklist reprovou estes pontos: ${allFailed.join("; ")}. Revise os prompts para atingir o padrão e avalie de novo.\n${dataBlock({ planejamento: plan.data })}`,
    }];
  }
  const lastFailed = history[history.length - 1]?.failed ?? [];
  return {
    pieces,
    review: { attempts: history.length, passed: lastFailed.length === 0, checklist: pieces[0]?.checklist ?? [], history },
  };
}

// Respostas e utilidades ---------------------------------------------------------
async function interpretReply(ctx: Ctx, project: Project, text: string) {
  const { data } = await llm().structured({
    schemaName: "intencao",
    schema: ReplyIntentSchema,
    model: ctx.cfg.textModel,
    system: `Você interpreta a resposta da pessoa no meio de um fluxo criativo. Etapa atual: ${project.stage}.
- escolher_conceito: escolheu um dos conceitos (informe o número).
- aprovar_planejamento: aprovou o planejamento sem pedir mudanças.
- alterar: pediu mudança nos conceitos, no planejamento ou nas peças (resuma o pedido em observacoes).
- novo_pedido: pediu uma peça nova, sem relação com este projeto.
- pergunta: fez uma pergunta ou comentário sem pedir ação.`,
    messages: [{ role: "user", text: `PROJETO: ${project.title} (${project.content_type})\nRESPOSTA: ${text}` }],
  });
  return data;
}

async function answer(ctx: Ctx, project: Project, text: string) {
  const memory = await buildBrandMemory(ctx.brand, project.id);
  const history = await chatHistory(ctx.conversationId);
  const { data } = await llm().structured({
    schemaName: "resposta", schema: AnswerSchema, model: ctx.cfg.textModel,
    system: `${memory}\n\n## TAREFA\nResponda à pergunta da pessoa sobre o projeto "${project.title}". Etapa: ${project.stage}. Não gere imagens.`,
    messages: [...history, { role: "user", text: `PERGUNTA: ${text}` }],
  });
  return say(ctx, data.resposta);
}

async function chatHistory(conversationId: string): Promise<ChatTurn[]> {
  const msgs = await listMessages(conversationId);
  return msgs
    .filter((m) => m.role !== "system" && m.content)
    .slice(-12, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", text: m.content.slice(0, 2000) }));
}

const say = (ctx: Ctx, text: string) => addMessage(ctx.conversationId, "assistant", "text", text);

async function conceptByNumber(projectId: string, n: number) {
  return queryOne<ConceptRow>(
    `SELECT * FROM concepts WHERE project_id = $1 AND number = $2 ORDER BY round DESC LIMIT 1`, [projectId, n]);
}

export const pad = (n: number) => String(n).padStart(2, "0");

export function publicRef(r: RetrievedReference) {
  return { id: r.id, name: r.name, category: r.category, status: r.status, favorite: r.favorite, media_type: r.media_type, similarity: r.similarity };
}

function briefingSummary(b: Briefing) {
  return [
    "Entendi o pedido:",
    `Tipo: ${CONTENT_TYPE_LABEL[b.tipo]}`,
    `Tema: ${b.tema}`,
    `Público: ${b.publico}`,
    `Objetivo: ${b.objetivo}`,
    `Ambiente: ${b.ambiente}`,
    `Estética: ${b.estetica}`,
  ].join("\n");
}

function researchSummary(r: NonNullable<Project["research"]>) {
  if (!r.disponivel) return r.resumo;
  return `Pesquisa de mercado: ${r.resumo}\nTendências atuais: ${r.tendencias_atuais.map((t) => t.titulo).join("; ") || "nenhuma confirmada"}`;
}

function planSummary(p: PlanData, c: ConceptRow) {
  return [
    `PLANEJAMENTO — CONCEITO ${pad(c.number)}`,
    `Conceito: ${p.conceito}`, `Objetivo: ${p.objetivo}`, `Ambiente: ${p.ambiente}`, `Cenário: ${p.cenario}`,
    `Paleta: ${p.paleta.join(", ")}`, `Materiais: ${p.materiais.join(", ")}`, `Produto protagonista: ${p.produto_protagonista}`,
    `Composição: ${p.composicao}`, `Enquadramento: ${p.enquadramento}`, `Iluminação: ${p.iluminacao}`, `Texto: ${p.texto}`,
    `Logo: ${p.logo}`, `Assinatura: ${p.assinatura}`, `Formato: ${p.formato}`,
    `Peças: ${p.pecas.map((s) => `${pad(s.numero)} ${s.papel}`).join(", ")}`,
  ].join("\n");
}

export { approvedPlan };
