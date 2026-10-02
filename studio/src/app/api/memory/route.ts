import { json, route } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { effectiveAI, getBrand } from "@/lib/repo/brand";
import { activeMasterPrompts, activePreferences, buildBrandMemory } from "@/lib/studio/context";

/** Mostra exatamente o que um chat novo sabe sobre a marca. */
export const GET = route(async () => {
  const brand = await getBrand();
  const [memory, prompts, preferences, refs] = await Promise.all([
    buildBrandMemory(brand, null),
    activeMasterPrompts(brand.id),
    activePreferences(brand.id, null),
    queryOne<{ aprovadas: number; favoritas: number; avaliacao: number }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'aprovada')::int AS aprovadas,
              COUNT(*) FILTER (WHERE favorite)::int AS favoritas,
              COUNT(*) FILTER (WHERE status = 'em_avaliacao')::int AS avaliacao
         FROM visual_references WHERE brand_id = $1`, [brand.id]),
  ]);
  return json({
    memory,
    prompts: prompts.map((p) => ({ title: p.title, version: p.version })),
    preferences: preferences.length,
    references: refs,
    ai: effectiveAI(brand),
  });
});
