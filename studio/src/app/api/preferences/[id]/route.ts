import { z } from "zod";
import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";

type P = { id: string };

const Patch = z.object({
  active: z.boolean().optional(),
  rule: z.string().trim().min(3).max(500).optional(),
  kind: z.enum(["preferir", "evitar", "regra"]).optional(),
  scope: z.enum(["marca", "projeto"]).optional(),
});

export const PATCH = route<P>(async ({ params, req }) => {
  const brand = await getBrand();
  const b = Patch.parse(await req.json());
  const current = await queryOne<{ project_id: string | null }>(`SELECT project_id FROM brand_preferences WHERE id = $1 AND brand_id = $2`, [params.id, brand.id]);
  if (!current) throw notFound("Preferência não encontrada.");
  if (b.scope === "projeto" && !current.project_id) throw badRequest("Esta preferência não está ligada a um projeto.");
  const preference = await queryOne(
    `UPDATE brand_preferences SET active = COALESCE($1, active), rule = COALESCE($2, rule), kind = COALESCE($3, kind), scope = COALESCE($4, scope)
      WHERE id = $5 RETURNING *`,
    [b.active ?? null, b.rule ?? null, b.kind ?? null, b.scope ?? null, params.id],
  );
  return json({ preference });
}, { role: "editor" });

export const DELETE = route<P>(async ({ params, req }) => {
  const brand = await getBrand();
  if (req.nextUrl.searchParams.get("confirmar") !== "sim") throw badRequest("Confirme a exclusão da preferência.");
  const rows = await query(`DELETE FROM brand_preferences WHERE id = $1 AND brand_id = $2 RETURNING id`, [params.id, brand.id]);
  if (!rows.length) throw notFound("Preferência não encontrada.");
  return json({ ok: true });
}, { role: "editor" });
