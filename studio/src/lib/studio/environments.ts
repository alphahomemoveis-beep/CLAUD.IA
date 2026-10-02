/**
 * Detecção de ambientes no texto. Usada para fazer valer a regra
 * "UMA ARTE = UM CONCEITO = UM AMBIENTE PRINCIPAL" no código, e não só no prompt.
 */
const ENVIRONMENTS: Array<[string, RegExp]> = [
  ["varanda gourmet", /\b(varanda|area gourmet|espaco gourmet|churrasqueira)\b/],
  ["cozinha", /\b(cozinhas?)\b/],
  ["sala", /\b(salas?|living|home theater)\b/],
  ["quarto", /\b(quartos?|dormitorios?|suites?)\b/],
  ["closet", /\b(closets?)\b/],
  ["lavanderia", /\b(lavanderias?|area de servico)\b/],
  ["home office", /\b(home office|escritorios?)\b/],
  ["banheiro", /\b(banheiros?|lavabos?)\b/],
];

export const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Lista os ambientes citados no texto, na ordem em que aparecem. */
export function detectEnvironments(text: string): string[] {
  const t = normalize(text);
  return ENVIRONMENTS
    .map(([name, re]) => ({ name, at: t.search(re) }))
    .filter((e) => e.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((e) => e.name);
}

/** true quando o texto mistura mais de um ambiente principal. */
export function mixesEnvironments(text: string): boolean {
  return detectEnvironments(text).length > 1;
}
