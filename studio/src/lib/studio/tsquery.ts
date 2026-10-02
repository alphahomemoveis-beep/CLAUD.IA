/**
 * Consulta de texto completo segura: só palavras, unidas por OU.
 * Nunca repassa a sintaxe do tsquery digitada pela pessoa.
 */
export function toTsQuery(text: string): string | null {
  const words = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{3,}/g) ?? [];
  const unique = [...new Set(words)].slice(0, 24);
  return unique.length ? unique.join(" | ") : null;
}
