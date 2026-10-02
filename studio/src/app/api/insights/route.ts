import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { getBrand } from "@/lib/repo/brand";

export const GET = route(async () => {
  const brand = await getBrand();
  const id = brand.id;
  const [totals, byType, byStatus, verdicts, topReferences, recentFeedback, research, library] = await Promise.all([
    queryOne(
      `SELECT (SELECT COUNT(*)::int FROM creative_projects WHERE brand_id = $1) AS projetos,
              (SELECT COUNT(*)::int FROM conversations WHERE brand_id = $1) AS conversas,
              (SELECT COUNT(*)::int FROM generated_images g JOIN creative_projects p ON p.id = g.project_id WHERE p.brand_id = $1 AND g.status = 'pronta') AS imagens,
              (SELECT COUNT(*)::int FROM brand_preferences WHERE brand_id = $1 AND active) AS preferencias`,
      [id],
    ),
    query(`SELECT content_type, COUNT(*)::int AS n FROM creative_projects WHERE brand_id = $1 GROUP BY 1 ORDER BY 2 DESC`, [id]),
    query(`SELECT status, COUNT(*)::int AS n FROM creative_projects WHERE brand_id = $1 GROUP BY 1 ORDER BY 2 DESC`, [id]),
    query(
      `SELECT COALESCE(g.verdict, 'sem_avaliacao') AS verdict, COUNT(*)::int AS n FROM generated_images g
         JOIN creative_projects p ON p.id = g.project_id WHERE p.brand_id = $1 AND g.status = 'pronta' GROUP BY 1`,
      [id],
    ),
    query(
      `SELECT r.id, r.name, r.category, COUNT(*)::int AS usos FROM creative_plans pl
         JOIN creative_projects p ON p.id = pl.project_id
         JOIN visual_references r ON r.id = ANY(pl.reference_ids)
        WHERE p.brand_id = $1 GROUP BY r.id ORDER BY usos DESC LIMIT 8`,
      [id],
    ),
    query(
      `SELECT f.kind, f.comment, f.created_at, p.title FROM feedback f JOIN creative_projects p ON p.id = f.project_id
        WHERE p.brand_id = $1 AND f.comment <> '' ORDER BY f.created_at DESC LIMIT 10`,
      [id],
    ),
    query(
      `SELECT id, title, research->>'pesquisado_em' AS pesquisado_em, research->'tendencias_atuais' AS tendencias,
              (research->>'disponivel')::boolean AS disponivel
         FROM creative_projects WHERE brand_id = $1 AND research IS NOT NULL ORDER BY created_at DESC LIMIT 6`,
      [id],
    ),
    query(`SELECT status, COUNT(*)::int AS n FROM visual_references WHERE brand_id = $1 GROUP BY 1`, [id]),
  ]);
  return json({ totals, byType, byStatus, verdicts, topReferences, recentFeedback, research, library });
});
