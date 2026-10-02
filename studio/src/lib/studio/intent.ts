import { normalize } from "./environments";

export type ParsedReply =
  | { kind: "choose"; number: number }
  | { kind: "approve" }
  | { kind: "unknown" };

const ORDINALS: Record<string, number> = {
  primeiro: 1, primeira: 1, um: 1, segundo: 2, segunda: 2, dois: 2, terceiro: 3, terceira: 3, tres: 3,
  quarto: 4, quarta: 4, quatro: 4, quinto: 5, quinta: 5, cinco: 5,
};

/**
 * Leitura rápida e determinística das respostas mais comuns. Só o que não
 * casar aqui vai para a IA interpretar.
 */
export function parseReply(raw: string): ParsedReply {
  const t = normalize(raw).trim().replace(/[.!?]+$/, "");
  if (!t) return { kind: "unknown" };

  const hasBut = /\b(mas|porem|so que|exceto|menos|troque|trocar|mude|mudar|altere|alterar|ajuste|ajustar)\b/.test(t);

  const num =
    t.match(/\b(?:conceito|opcao|ideia|numero|n[oº]?)\s*0?([1-5])\b/) ??
    t.match(/^(?:o|a|quero o|quero a|vou de|fico com o|fico com a|escolho o|escolho a)?\s*0?([1-5])$/);
  if (num && !hasBut) return { kind: "choose", number: Number(num[1]) };

  const ord = t.match(/\b(?:o|a)?\s*(primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa])\s*(?:conceito|opcao|ideia)?$/);
  if (ord && !hasBut && t.split(/\s+/).length <= 5) return { kind: "choose", number: ORDINALS[ord[1]] };

  if (
    !hasBut &&
    t.length <= 60 &&
    /^(sim|s|ok|okay|aprovado|aprovada|aprovar|aprovo|aprovar planejamento|pode gerar|pode seguir|pode criar|pode fazer|gera|gerar|perfeito|fechado|manda ver|bora|vamos|isso|esta otimo|ta otimo|otimo|show)\b/.test(t)
  ) {
    return { kind: "approve" };
  }
  return { kind: "unknown" };
}
