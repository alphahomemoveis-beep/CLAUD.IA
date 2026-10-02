/** Rótulos compartilhados entre servidor e navegador. */
export const TYPE_LABEL: Record<string, string> = { carrossel: "Carrossel", reels: "Reels", arte: "Arte", imagem: "Imagem", story: "Story" };

export const STAGE_LABEL: Record<string, string> = {
  briefing: "Briefing", conceitos: "Conceitos", planejamento: "Planejamento", aprovado: "Aprovado", gerado: "Gerado",
};
export const STAGE_ORDER = ["briefing", "conceitos", "planejamento", "aprovado", "gerado"];

export const PROJECT_STATUS: Record<string, { label: string; icon: string; tone: string }> = {
  em_desenvolvimento: { label: "Em desenvolvimento", icon: "🟡", tone: "chip-warn" },
  em_revisao: { label: "Em revisão", icon: "🟠", tone: "chip-wood" },
  concluido: { label: "Concluído", icon: "🟢", tone: "chip-ok" },
  arquivado: { label: "Arquivado", icon: "⚪", tone: "" },
};

export const REF_STATUS: Record<string, { label: string; icon: string; tone: string; help: string }> = {
  referencia: { label: "Referência", icon: "🔵", tone: "chip-info", help: "Imagem adicionada para análise." },
  em_avaliacao: { label: "Em avaliação", icon: "🟡", tone: "chip-warn", help: "Analisada, ainda não aprovada como padrão." },
  aprovada: { label: "Aprovada", icon: "🟢", tone: "chip-ok", help: "Referência oficial da linguagem visual." },
  rejeitada: { label: "Rejeitada", icon: "❌", tone: "chip-bad", help: "Linguagem a evitar." },
};

export const CATEGORIES: Array<{ id: string; label: string; icon: string }> = [
  { id: "identidade", label: "Identidade", icon: "🎨" },
  { id: "ambientes", label: "Ambientes", icon: "🏠" },
  { id: "materiais", label: "Materiais", icon: "🪵" },
  { id: "iluminacao", label: "Iluminação", icon: "💡" },
  { id: "arquitetura", label: "Arquitetura", icon: "📐" },
  { id: "instagram", label: "Instagram", icon: "📱" },
  { id: "tipografia", label: "Tipografia", icon: "✍️" },
  { id: "assinatura", label: "Assinatura", icon: "🖋️" },
  { id: "fotografia", label: "Fotografia", icon: "📸" },
];

export const QUALITY_LABEL: Record<string, string> = {
  identidade: "Identidade", ambiente: "Um ambiente", marcenaria: "Marcenaria plausível", estetica: "Fotografia profissional",
  composicao: "Composição limpa", texto: "Texto limpo", logo: "Logo integrada", assinatura: "Assinatura elegante",
  referencias: "Referências sem cópia", instagram: "Razão estratégica",
};

export const REJECT_EXAMPLES = [
  "Muito texto.", "Ficou parecendo catálogo.", "Quero mais elegante.", "Quero apenas uma cozinha.",
  "A assinatura ficou ruim.", "Muito escuro.", "Quero mais parecido com nossas referências.",
];
