import { z } from "zod";
import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { getBrand } from "@/lib/repo/brand";

export const GET = route(async () => {
  const brand = await getBrand();
  const preferences = await query(
    `SELECT bp.*, p.title AS project_title, f.comment AS feedback_comment, f.kind AS feedback_kind
       FROM brand_preferences bp
       LEFT JOIN creative_projects p ON p.id = bp.project_id
       LEFT JOIN feedback f ON f.id = bp.source_feedback_id
      WHERE bp.brand_id = $1 ORDER BY bp.active DESC, bp.created_at DESC`,
    [brand.id],
  );
  return json({ preferences });
});

const Body = z.object({
  kind: z.enum(["preferir", "evitar", "regra"]),
  rule: z.string().trim().min(3).max(500),
});

export const POST = route(async ({ req, user }) => {
  const brand = await getBrand();
  const b = Body.parse(await req.json());
  const preference = await queryOne(
    `INSERT INTO brand_preferences (brand_id, scope, kind, rule, source, created_by) VALUES ($1,'marca',$2,$3,'manual',$4) RETURNING *`,
    [brand.id, b.kind, b.rule, user.id],
  );
  return json({ preference }, 201);
}, { role: "editor" });
