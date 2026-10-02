import { z, type ZodType } from "zod";

/**
 * Palavras-chave que o modo estrito de saída estruturada pode recusar.
 * Os limites continuam valendo porque a resposta é validada com zod depois.
 */
const STRIP = new Set(["$schema", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "pattern", "format", "default", "multipleOf"]);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (STRIP.has(k)) continue;
    out[k] = clean(v);
  }
  return out;
}

export function toStrictJsonSchema(schema: ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema, { target: "draft-2020-12" })) as Record<string, unknown>;
}
