import { z } from "zod";
import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";

const n = z.number().int().min(0).max(10_000_000_000).nullable().default(null);
const Body = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  followers: n, reach: n, impressions: n, views: n, profile_views: n, interactions: n,
});

/** Lançamento manual de números (quando a integração não cobre aquele perfil). */
export const POST = route<{ id: string }>(async ({ params, req }) => {
  const brand = await getBrand();
  const prof = await queryOne(`SELECT id FROM tracked_profiles WHERE id = $1 AND brand_id = $2`, [params.id, brand.id]);
  if (!prof) throw notFound("Perfil não encontrado.");
  const b = Body.parse(await req.json());
  await query(
    `INSERT INTO profile_metrics (profile_id, day, source, followers, reach, impressions, views, profile_views, interactions)
     VALUES ($1,$2,'manual',$3,$4,$5,$6,$7,$8)
     ON CONFLICT (profile_id, day, source) DO UPDATE SET followers = EXCLUDED.followers, reach = EXCLUDED.reach,
       impressions = EXCLUDED.impressions, views = EXCLUDED.views, profile_views = EXCLUDED.profile_views,
       interactions = EXCLUDED.interactions, synced_at = now()`,
    [params.id, b.day, b.followers, b.reach, b.impressions, b.views, b.profile_views, b.interactions]);
  return json({ ok: true });
}, { role: "editor" });
