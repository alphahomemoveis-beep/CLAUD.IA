import type { AgentRequest, AgentResult, AgentToolCall, EmbeddingProvider, ImageProvider, ImageRequest, ImageResult, StructuredRequest, StructuredResult, TextProvider } from "./types";
import type { Answer, Briefing, ConceptData, ConceptSet, FeedbackLesson, FinalPrompts, PlanData, ReferenceAnalysis, ReplyIntent, Research, RevisedPrompt } from "./schemas";
import { QUALITY_ITEMS } from "./schemas";
import { detectEnvironments } from "../studio/environments";
import { parseReply } from "../studio/intent";

/**
 * Provedor de teste. Não chama nenhuma API: devolve respostas determinísticas
 * coerentes com o pedido, para testar o fluxo e a interface sem custo.
 * Nunca finge pesquisa real: a pesquisa simulada avisa que é simulada.
 */
export class MockText implements TextProvider {
  readonly name = "mock";

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const last = req.messages[req.messages.length - 1]?.text ?? "";
    const data = extractJson(last);
    const build = BUILDERS[req.schemaName];
    if (!build) throw new Error(`Provedor de teste não conhece o esquema ${req.schemaName}`);
    const out = build(last, data);
    return { data: req.schema.parse(out), sources: [], model: "mock" };
  }

  /**
   * Agente de teste: entende pedidos simples de agenda ("agenda o vídeo da
   * casa 12 para amanhã às 19h") chamando as mesmas ferramentas do Claude.
   */
  async agent(req: AgentRequest): Promise<AgentResult> {
    const text = req.messages[req.messages.length - 1]?.text ?? "";
    const calls: AgentToolCall[] = [];
    const call = async (name: string, input: unknown) => {
      const tool = req.tools.find((t) => t.name === name);
      if (!tool) return null;
      const parsed = tool.schema.parse(input);
      try {
        const output = await tool.run(parsed);
        calls.push({ name, input: parsed, output });
        return output as Record<string, unknown>;
      } catch (err) {
        calls.push({ name, input: parsed, output: null, error: (err as Error).message });
        return null;
      }
    };
    const pedido = text.replace(/^AGORA:.*\n/, "");
    if (/agend|program|post|publica|coloc|bota|sobe/i.test(pedido)) {
      const busca = pedido.match(/(casa|apto|apartamento|condom[ií]nio|obra|resultado|projeto)[^,.;]*/i)?.[0] ?? pedido;
      const found = (await call("buscar_midias", { consulta: busca, etapa: null, tipo: null, limite: 5 })) as { midias?: Array<{ id: string; tipo: string }> } | null;
      const media = found?.midias?.[0];
      if (!media) return { text: "Não encontrei mídia para esse pedido. Diga a pasta e a etapa (Projeto, Obra ou Resultado).", toolCalls: calls, model: "mock" };
      const hora = pedido.match(/(\d{1,2})\s*(?:h|:)(\d{2})?/);
      const quando = new Date(Date.now() + 86400_000);
      const dia = quando.toISOString().slice(0, 10);
      const hh = String(hora ? Number(hora[1]) : 19).padStart(2, "0");
      const mm = hora?.[2] ?? "00";
      await call("criar_rascunho_post", {
        midia_ids: [media.id], data_hora_local: `${dia}T${hh}:${mm}:00`, tipo: media.tipo === "video" ? "REEL" : "POST",
        legenda: "Cada detalhe pensado para a sua rotina. Marcenaria planejada AlphaHome.",
        hashtags: ["#moveisplanejados", "#marcenaria", "#altopadrao"], primeiro_comentario: null, redes: ["instagram"],
      });
      return { text: `Preparei o rascunho do post para ${dia} às ${hh}:${mm}. Confira e confirme no cartão.`, toolCalls: calls, model: "mock" };
    }
    if (/lista|quais|pr[oó]xim/i.test(pedido)) {
      await call("listar_posts", { de: null, ate: null });
      return { text: "Aqui estão os próximos posts.", toolCalls: calls, model: "mock" };
    }
    return { text: "Diga o que agendar, por exemplo: \"Agenda o vídeo da obra da Casa 12 para amanhã às 19h\".", toolCalls: calls, model: "mock" };
  }
}

export class MockEmbeddings implements EmbeddingProvider {
  readonly name = "mock";
  readonly model = "mock-hash-256";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(hashEmbedding);
  }
}

export class MockImages implements ImageProvider {
  readonly name = "mock";
  async image(req: ImageRequest): Promise<ImageResult> {
    const [w, h] = req.size.split("x").map(Number);
    const title = (req.prompt.match(/TEXT ON IMAGE: "([^"]*)"/)?.[1] ?? "AlphaHome").slice(0, 60);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9dfd1"/><stop offset="1" stop-color="#8a6a4f"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<rect x="${w * 0.12}" y="${h * 0.35}" width="${w * 0.76}" height="${h * 0.4}" fill="#5c4634" opacity="0.55"/>
<rect x="${w * 0.12}" y="${h * 0.33}" width="${w * 0.76}" height="6" fill="#ffd9a0" opacity="0.9"/>
<text x="50%" y="${h * 0.18}" text-anchor="middle" font-family="Georgia, serif" font-size="${w * 0.055}" fill="#1f1b16">${escapeXml(title)}</text>
<text x="50%" y="${h * 0.93}" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="${w * 0.04}" fill="#f7f4ef">AlphaHome</text>
<text x="50%" y="${h * 0.97}" text-anchor="middle" font-family="sans-serif" font-size="${w * 0.018}" fill="#f7f4ef" opacity="0.8">IMAGEM DE TESTE (provedor mock)</text>
</svg>`;
    return { data: Buffer.from(svg), mime: "image/svg+xml", ext: "svg", model: "mock" };
  }
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

function extractJson(text: string): Record<string, unknown> {
  const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
  if (!blocks.length) return {};
  try {
    return JSON.parse(blocks[blocks.length - 1][1]);
  } catch {
    return {};
  }
}

export function hashEmbedding(text: string): number[] {
  const dims = 256;
  const v = new Array<number>(dims).fill(0);
  const words = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) ?? [];
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[Math.abs(h) % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function detectType(text: string): Briefing["tipo"] {
  const t = text.toLowerCase();
  if (t.includes("carrossel") || t.includes("carrosel")) return "carrossel";
  if (t.includes("reels") || t.includes("reel") || t.includes("vídeo") || t.includes("video") || t.includes("roteiro")) return "reels";
  if (t.includes("story") || t.includes("stories")) return "story";
  if (t.includes("imagem") || t.includes("foto") || t.includes("render")) return "imagem";
  return "arte";
}

const PALETTES = [
  "Freijó + fendi + pedra clara",
  "Verde sálvia + madeira natural + linho",
  "Nogueira + off-white + latão escovado",
  "Carvalho claro + areia + travertino",
  "Grafite suave + madeira tauari + LED quente",
];

const PROTAGONISTS = ["Gavetas organizadoras", "Organização interna", "Painel ripado com LED", "Torre quente embutida", "Portas com puxador cava"];

const BUILDERS: Record<string, (text: string, data: Record<string, unknown>) => unknown> = {
  briefing(text): Briefing {
    const pedido = text.split("\n").find((l) => l.startsWith("PEDIDO:"))?.replace("PEDIDO:", "").trim() ?? text;
    const criativo = /cri[ea]|quero|fa[cç]a|ger[ea]|arte|carross?el|reels?|imagem|post|story|roteiro|v[ií]deo/i.test(pedido);
    const envs = detectEnvironments(pedido);
    const tipo = detectType(pedido);
    const tema = pedido.replace(/^(crie|criar|quero|fa[cç]a|gere)\s+(um|uma)?\s*/i, "").replace(/\.$/, "");
    return {
      eh_pedido_criativo: criativo,
      resposta_direta: criativo ? null : "Estou aqui para criar com você. Diga o que quer criar, por exemplo: \"Crie um carrossel sobre cozinhas pequenas\".",
      tipo,
      tema,
      publico: "Clientes interessados em ambientes planejados de alto padrão",
      objetivo: tipo === "carrossel" ? "Informação + salvamento + desejo" : "Desejo + autoridade",
      ambiente: envs[0] ? envs[0][0].toUpperCase() + envs[0].slice(1) : "A definir",
      multiplos_ambientes_solicitados: envs.length > 1 && /e (também|tambem)|vários|varios|todos os ambientes/i.test(pedido),
      estetica: "Baseada na biblioteca AlphaHome",
      titulo_projeto: `${tipo[0].toUpperCase()}${tipo.slice(1)} — ${tema.slice(0, 40)}`,
      consulta_referencias: tema,
      temas_pesquisa: [`${tema} marcenaria alto padrão`, "tendências interiores 2026"],
      observacoes: "Gerado pelo provedor de teste.",
    };
  },
  pesquisa(): Research {
    return {
      resumo: "Modo de teste: nenhuma pesquisa real foi feita. Ligue o provedor OpenAI para pesquisar tendências atuais.",
      tendencias_atuais: [],
      referencias_historicas: [
        { titulo: "Madeira natural com LED quente", descricao: "Linguagem consolidada da marcenaria de alto padrão.", por_que_ainda_importa: "Transmite acolhimento e sofisticação." },
      ],
      formatos_em_alta: [],
      oportunidades_para_marca: ["Mostrar detalhes de funcionamento em close"],
      cuidados: ["Não tratar estes itens como tendência atual: são simulados."],
    };
  },
  conceitos(_t, data): ConceptSet {
    const briefing = (data.briefing ?? {}) as Partial<Briefing>;
    const refs = ((data.referencias ?? []) as Array<{ id: string }>).map((r) => r.id);
    const base = briefing.ambiente && briefing.ambiente !== "A definir" ? briefing.ambiente : null;
    const envs = base ? [base, base, base, base, base] : ["Cozinha planejada", "Cozinha contemporânea", "Sala integrada", "Closet", "Home office"];
    const titles = [
      "O móvel que faz seu dia render mais.",
      "Pequenos detalhes, grandes diferenças.",
      "Sua casa trabalhando por você.",
      "Tudo no lugar, sem esforço.",
      "Feito para a sua rotina.",
    ];
    const count = Number(data.quantidade ?? 5);
    return {
      introducao: `Analisei o pedido sobre "${briefing.tema ?? "o tema"}" e preparei estes caminhos.`,
      conceitos: titles.slice(0, Math.max(3, Math.min(5, count))).map((titulo, i) => ({
        numero: i + 1,
        titulo,
        ambiente: envs[i],
        paleta: PALETTES[i],
        protagonista: PROTAGONISTS[i],
        objetivo: i % 2 ? "Mostrar organização" : "Mostrar praticidade",
        ideia: `Um ${briefing.tipo ?? "conteúdo"} com foco em ${PROTAGONISTS[i].toLowerCase()}, luz quente e enquadramento limpo.`,
        por_que_funciona: "Une desejo e utilidade, o que aumenta salvamentos.",
        referencias_ids: refs.slice(0, 2),
      })),
      recomendacao: "Recomendo o Conceito 1: é o mais direto e o mais fácil de mostrar em uma única cena.",
    };
  },
  intencao(text): ReplyIntent {
    const msg = text.split("\n").find((l) => l.startsWith("RESPOSTA:"))?.replace("RESPOSTA:", "").trim() ?? text;
    const parsed = parseReply(msg);
    if (parsed.kind === "choose") return { acao: "escolher_conceito", numero_conceito: parsed.number, observacoes: "" };
    if (parsed.kind === "approve") return { acao: "aprovar_planejamento", numero_conceito: null, observacoes: "" };
    if (/^(crie|quero|fa[cç]a)\b/i.test(msg)) return { acao: "novo_pedido", numero_conceito: null, observacoes: msg };
    return { acao: "alterar", numero_conceito: null, observacoes: msg };
  },
  planejamento(_t, data): PlanData {
    const c = (data.conceito ?? {}) as Partial<ConceptData>;
    const tipo = String((data.briefing as Partial<Briefing> | undefined)?.tipo ?? "arte");
    const refs = (data.referencias ?? []) as Array<{ id: string; nome: string }>;
    const roles = tipo === "carrossel" ? ["GANCHO", "PROBLEMA", "SOLUÇÃO", "EXEMPLO", "CTA"] : tipo === "reels" ? ["CAPA"] : ["ARTE"];
    const ajuste = data.ajustes ? ` Ajuste pedido: ${String(data.ajustes)}.` : "";
    return {
      conceito: c.titulo ?? "Conceito",
      objetivo: c.objetivo ?? "Mostrar praticidade",
      ambiente: c.ambiente ?? "Cozinha planejada",
      cenario: `Ambiente real, limpo, com marcenaria sob medida e luz natural lateral.${ajuste}`,
      paleta: (c.paleta ?? PALETTES[0]).split("+").map((s) => s.trim()),
      materiais: ["MDF amadeirado", "Laca fosca", "Pedra natural", "Fita de LED 2700K"],
      produto_protagonista: c.protagonista ?? "Gavetas organizadoras",
      composicao: "Protagonista no terço inferior, respiro no topo para o texto.",
      enquadramento: "Plano médio frontal, câmera na altura do tampo.",
      iluminacao: "Luz natural suave + LED quente embutido.",
      texto: "Título curto em serifa fina, uma linha de apoio.",
      logo: "AlphaHome discreto no rodapé, em branco a 80%.",
      assinatura: "Assinatura cursiva fina e fantasma integrada à madeira.",
      referencias_utilizadas: refs.slice(0, 2).map((r) => ({ id: r.id, nome: r.nome, o_que_absorver: "Luz quente e madeira natural" })),
      formato: tipo === "reels" ? "Reels 9:16 + capa" : tipo === "carrossel" ? `Carrossel ${roles.length} slides 4:5` : "Post 4:5",
      proporcao: tipo === "reels" || tipo === "story" ? "9:16" : "4:5",
      estrategia_instagram: {
        objetivo: "Salvamentos e mensagens no Direct",
        legenda_sugerida: `${c.titulo ?? ""} Cada detalhe pensado para a sua rotina.`,
        cta: "Chama a AlphaHome no Direct.",
        hashtags: ["#moveisplanejados", "#marcenaria", "#altopadrao"],
        melhor_uso: "Feed, terça ou quinta à noite.",
      },
      pecas: roles.map((papel, i) => ({
        numero: i + 1,
        papel,
        titulo: i === 0 ? c.titulo ?? "AlphaHome" : `${papel[0]}${papel.slice(1).toLowerCase()}`,
        texto_na_arte: i === 0 ? c.titulo ?? "" : papel === "CTA" ? "Chama a AlphaHome no Direct" : `${papel.toLowerCase()}`,
        descricao_visual: `${c.ambiente ?? "Ambiente"} com ${c.protagonista ?? "marcenaria"} em destaque.`,
        enquadramento: i % 2 ? "Close no detalhe" : "Plano médio",
      })),
      roteiro: tipo === "reels"
        ? {
            blocos: (["GANCHO", "DESENVOLVIMENTO", "DEMONSTRACAO", "VIRADA", "CTA"] as const).map((etapa, i) => ({
              etapa,
              texto_falado: etapa === "CTA" ? "Chama a AlphaHome no Direct e vem orçar com quem entende." : `Fala da etapa ${etapa.toLowerCase()}.`,
              texto_na_tela: etapa,
              cena: `${c.ambiente ?? "Ambiente"}, cena ${i + 1}`,
              enquadramento: i % 2 ? "Plano fechado" : "Plano aberto",
              broll: c.protagonista ?? "Detalhe da marcenaria",
              duracao_segundos: [3, 15, 15, 8, 5][i],
            })),
            duracao_total_segundos: 46,
            sugestao_edicao: "Cortes a cada 3 a 5 segundos, legenda central branca.",
            objetivo_video: "Gerar desejo e mensagens no Direct",
          }
        : null,
    };
  },
  prompts_finais(_t, data): FinalPrompts {
    const plan = data.planejamento as PlanData;
    return {
      pecas: plan.pecas.map((p) => ({
        numero: p.numero,
        prompt_final: `Professional interior photograph, ${plan.ambiente}, ${p.descricao_visual}. Palette: ${plan.paleta.join(", ")}. TEXT ON IMAGE: "${p.texto_na_arte}"`,
        texto_exato_na_imagem: p.texto_na_arte || null,
        checklist: QUALITY_ITEMS.map((item) => ({ item, aprovado: true, observacao: "OK (teste)" })),
      })),
    };
  },
  revisao_peca(_t, data): RevisedPrompt {
    const anterior = String(data.prompt_anterior ?? "");
    const pedido = String(data.pedido ?? "");
    return {
      prompt_final: `${anterior} Revision: ${pedido}`,
      texto_exato_na_imagem: (anterior.match(/TEXT ON IMAGE: "([^"]*)"/)?.[1]) ?? null,
      resumo_da_mudanca: `Apliquei: ${pedido}`,
      checklist: QUALITY_ITEMS.map((item) => ({ item, aprovado: true, observacao: "OK (teste)" })),
    };
  },
  analise_referencia(): ReferenceAnalysis {
    return {
      nome_sugerido: "Referência sem nome",
      categoria_sugerida: "ambientes",
      descricao_visual: "Análise simulada pelo provedor de teste. Ligue a OpenAI para analisar a imagem de verdade.",
      ambiente: "A definir",
      estilo: "Contemporâneo",
      cores: [{ nome: "Madeira", hex: "#8A6A4F" }, { nome: "Off-white", hex: "#F2EDE6" }],
      materiais: ["Madeira"],
      iluminacao: "Quente",
      enquadramento: "Frontal",
      composicao: "Equilibrada",
      arquitetura: "",
      moveis: [],
      nivel_realismo: "Fotográfico",
      tipografia: "Nenhuma",
      direcao_arte: "Minimalista",
      sensacao: "Acolhimento",
      caracteristicas_interessantes: [],
      evitar: [],
      usos_recomendados: ["Referência de iluminação"],
      tags: ["teste"],
    };
  },
  resposta(text): Answer {
    return { resposta: `Resposta de teste para: ${text.split("\n").find((l) => l.startsWith("PERGUNTA:"))?.replace("PERGUNTA:", "").trim() ?? "sua pergunta"}` };
  },
  editorial(_t, data) {
    const k = (data.kpis ?? {}) as Record<string, { atual: number | null; variacao_pct: number | null }>;
    const seg = k.seguidores;
    return {
      manchete: seg?.variacao_pct != null ? `Seguidores ${seg.variacao_pct >= 0 ? "sobem" : "caem"} ${Math.abs(seg.variacao_pct).toFixed(1)}% no período` : "Edição sem dados suficientes",
      linha_fina: "Resumo de teste gerado sem IA.",
      materias: [{ titulo: "Como foi o período", texto: "Texto de teste. Ligue o Claude para o editorial real." }],
      recomendacoes: ["Publicar mais vídeos de resultado final."],
    };
  },
  licao_feedback(_t, data): FeedbackLesson {
    const comentario = String(data.comentario ?? "").trim();
    return { regras: comentario ? [{ tipo: "evitar", regra: comentario }] : [] };
  },
};
