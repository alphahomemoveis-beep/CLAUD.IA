import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { getBrand } from "@/lib/repo/brand";

export const GET = route(async ({ req }) => {
  const brand = await getBrand();
  const status = req.nextUrl.searchParams.get("status");
  const projects = await query(
    `SELECT p.id, p.title, p.content_type, p.stage, p.status, p.current_version, p.conversation_id, p.created_at, p.updated_at,
            c.title AS concept_title,
            (SELECT id FROM generated_images g WHERE g.project_id = p.id AND g.status = 'pronta'
              ORDER BY g.favorite DESC, (g.verdict = 'aprovada') DESC NULLS LAST, g.version DESC, g.slide_number LIMIT 1) AS cover_image_id,
            (SELECT COUNT(*)::int FROM generated_images g WHERE g.project_id = p.id AND g.status = 'pronta') AS images
       FROM creative_projects p LEFT JOIN concepts c ON c.id = p.chosen_concept_id
      WHERE p.brand_id = $1 AND ($2::text IS NULL OR p.status = $2)
      ORDER BY p.updated_at DESC LIMIT 200`,
    [brand.id, status],
  );
  return json({ projects });
});
