import { z } from "zod";

/** Tipos de conteúdo que o estúdio produz. */
export const CONTENT_TYPES = ["carrossel", "reels", "arte", "imagem", "story"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const QUALITY_ITEMS = [
  "identidade", "ambiente", "marcenaria", "estetica", "composicao",
  "texto", "logo", "assinatura", "referencias", "instagram",
] as const;

export const REFERENCE_CATEGORIES = [
  "identidade", "ambientes", "materiais", "iluminacao", "arquitetura",
  "instagram", "tipografia", "assinatura", "fotografia",
] as const;

// 1. Análise do pedido -----------------------------------------------------------
export const BriefingSchema = z.object({
  eh_pedido_criativo: z.boolean().describe("true se a pessoa pediu uma criação (arte, carrossel, reels, imagem, story)"),
  resposta_direta: z.string().nullable().describe("Se não for pedido criativo, a resposta à pergunta. Senão, null."),
  tipo: z.enum(CONTENT_TYPES),
  tema: z.string(),
  publico: z.string(),
  objetivo: z.string(),
  ambiente: z.string().describe("Ambiente principal pedido, ou 'A definir'"),
  multiplos_ambientes_solicitados: z.boolean().describe("true só se a pessoa pediu explicitamente mais de um ambiente"),
  estetica: z.string(),
  titulo_projeto: z.string().describe("Ex.: 'Carrossel — Praticidade'"),
  consulta_referencias: z.string().describe("Frase para buscar referências visuais relevantes na biblioteca"),
  temas_pesquisa: z.array(z.string()).describe("2 a 4 temas para pesquisar tendências atuais"),
  observacoes: z.string(),
});
export type Briefing = z.infer<typeof BriefingSchema>;

// 2. Pesquisa de mercado ---------------------------------------------------------
export const ResearchSchema = z.object({
  resumo: z.string(),
  tendencias_atuais: z.array(z.object({
    titulo: z.string(),
    descricao: z.string(),
    evidencia: z.string().describe("O que foi encontrado na pesquisa que sustenta a tendência"),
    fonte_url: z.string().nullable(),
    data_referencia: z.string().nullable().describe("Mês/ano da fonte, se conhecido"),
  })),
  referencias_historicas: z.array(z.object({
    titulo: z.string(),
    descricao: z.string(),
    por_que_ainda_importa: z.string(),
  })),
  formatos_em_alta: z.array(z.string()),
  oportunidades_para_marca: z.array(z.string()),
  cuidados: z.array(z.string()),
});
export type Research = z.infer<typeof ResearchSchema>;

// 3. Conceitos -------------------------------------------------------------------
export const ConceptSchema = z.object({
  numero: z.number().int(),
  titulo: z.string().describe("Frase-conceito curta, entre aspas na apresentação"),
  ambiente: z.string().describe("UM ambiente principal"),
  paleta: z.string(),
  protagonista: z.string(),
  objetivo: z.string(),
  ideia: z.string().describe("Duas ou três frases explicando a ideia"),
  por_que_funciona: z.string(),
  referencias_ids: z.array(z.string()).describe("IDs das referências da biblioteca que inspiram o conceito"),
});
export const ConceptSetSchema = z.object({
  introducao: z.string(),
  conceitos: z.array(ConceptSchema).min(3).max(5),
  recomendacao: z.string().describe("Qual conceito você recomenda e por quê"),
});
export type ConceptData = z.infer<typeof ConceptSchema>;
export type ConceptSet = z.infer<typeof ConceptSetSchema>;

// 4. Planejamento ----------------------------------------------------------------
export const PieceSchema = z.object({
  numero: z.number().int(),
  papel: z.string().describe("Ex.: GANCHO, PROBLEMA, SOLUÇÃO, EXEMPLO, CTA, ARTE, CAPA"),
  titulo: z.string(),
  texto_na_arte: z.string().describe("Texto exato que aparece na imagem. Curto."),
  descricao_visual: z.string(),
  enquadramento: z.string(),
});

export const ScriptBlockSchema = z.object({
  etapa: z.enum(["GANCHO", "DESENVOLVIMENTO", "DEMONSTRACAO", "VIRADA", "CTA"]),
  texto_falado: z.string(),
  texto_na_tela: z.string(),
  cena: z.string(),
  enquadramento: z.string(),
  broll: z.string(),
  duracao_segundos: z.number(),
});

export const PlanSchema = z.object({
  conceito: z.string(),
  objetivo: z.string(),
  ambiente: z.string(),
  cenario: z.string(),
  paleta: z.array(z.string()),
  materiais: z.array(z.string()),
  produto_protagonista: z.string(),
  composicao: z.string(),
  enquadramento: z.string(),
  iluminacao: z.string(),
  texto: z.string(),
  logo: z.string(),
  assinatura: z.string(),
  referencias_utilizadas: z.array(z.object({ id: z.string(), nome: z.string(), o_que_absorver: z.string() })),
  formato: z.string(),
  proporcao: z.enum(["4:5", "9:16", "1:1"]),
  estrategia_instagram: z.object({
    objetivo: z.string(),
    legenda_sugerida: z.string(),
    cta: z.string(),
    hashtags: z.array(z.string()),
    melhor_uso: z.string(),
  }),
  pecas: z.array(PieceSchema).min(1).max(10),
  roteiro: z.object({
    blocos: z.array(ScriptBlockSchema),
    duracao_total_segundos: z.number(),
    sugestao_edicao: z.string(),
    objetivo_video: z.string(),
  }).nullable().describe("Só para Reels. Para outros formatos, null."),
});
export type PlanData = z.infer<typeof PlanSchema>;

// 5. Prompt final + checklist de qualidade ---------------------------------------
export const ChecklistItemSchema = z.object({
  item: z.enum(QUALITY_ITEMS),
  aprovado: z.boolean(),
  observacao: z.string(),
});
export const FinalPromptsSchema = z.object({
  pecas: z.array(z.object({
    numero: z.number().int(),
    prompt_final: z.string().describe("Prompt completo para o modelo de imagem, em inglês"),
    texto_exato_na_imagem: z.string().nullable(),
    checklist: z.array(ChecklistItemSchema),
  })),
});
export type FinalPrompts = z.infer<typeof FinalPromptsSchema>;
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

// 6. Análise de referência visual ------------------------------------------------
export const ReferenceAnalysisSchema = z.object({
  nome_sugerido: z.string(),
  categoria_sugerida: z.enum(REFERENCE_CATEGORIES),
  descricao_visual: z.string(),
  ambiente: z.string(),
  estilo: z.string(),
  cores: z.array(z.object({ nome: z.string(), hex: z.string() })),
  materiais: z.array(z.string()),
  iluminacao: z.string(),
  enquadramento: z.string(),
  composicao: z.string(),
  arquitetura: z.string(),
  moveis: z.array(z.string()),
  nivel_realismo: z.string(),
  tipografia: z.string(),
  direcao_arte: z.string(),
  sensacao: z.string(),
  caracteristicas_interessantes: z.array(z.string()),
  evitar: z.array(z.string()),
  usos_recomendados: z.array(z.string()),
  tags: z.array(z.string()),
});
export type ReferenceAnalysis = z.infer<typeof ReferenceAnalysisSchema>;

// 7. Interpretação de respostas no meio do fluxo ---------------------------------
export const ReplyIntentSchema = z.object({
  acao: z.enum(["escolher_conceito", "aprovar_planejamento", "alterar", "novo_pedido", "pergunta"]),
  numero_conceito: z.number().int().nullable(),
  observacoes: z.string(),
});
export type ReplyIntent = z.infer<typeof ReplyIntentSchema>;

// 8. Aprendizado com feedback ----------------------------------------------------
export const FeedbackLessonSchema = z.object({
  regras: z.array(z.object({
    tipo: z.enum(["preferir", "evitar", "regra"]),
    regra: z.string().describe("Regra curta e reaplicável, ex.: 'Evitar mais de 8 palavras na arte'"),
  })),
});
export type FeedbackLesson = z.infer<typeof FeedbackLessonSchema>;

// 9. Revisão de uma peça a pedido -------------------------------------------------
export const RevisedPromptSchema = z.object({
  prompt_final: z.string(),
  texto_exato_na_imagem: z.string().nullable(),
  resumo_da_mudanca: z.string(),
  checklist: z.array(ChecklistItemSchema),
});
export type RevisedPrompt = z.infer<typeof RevisedPromptSchema>;

// 10. Resposta livre (perguntas no meio do fluxo) ----------------------------------
export const AnswerSchema = z.object({ resposta: z.string() });
export type Answer = z.infer<typeof AnswerSchema>;

// 11. Jornal: editorial escrito a partir dos números calculados -------------------
export const EditorialSchema = z.object({
  manchete: z.string().describe("Manchete curta com o fato mais importante do período"),
  linha_fina: z.string().describe("Uma frase de apoio abaixo da manchete"),
  materias: z.array(z.object({ titulo: z.string(), texto: z.string().describe("Dois ou três parágrafos curtos") })).min(1).max(4),
  recomendacoes: z.array(z.string()).describe("De 2 a 4 ações concretas para o próximo período"),
});
export type Editorial = z.infer<typeof EditorialSchema>;
