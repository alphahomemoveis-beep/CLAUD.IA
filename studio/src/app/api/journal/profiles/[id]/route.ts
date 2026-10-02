import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";

export const DELETE = route<{ id: string }>(async ({ params, req }) => {
  const brand = await getBrand();
  if (req.nextUrl.searchParams.get("confirmar") !== "sim") throw badRequest("Confirme a remoção do perfil.");
  const rows = await query(`DELETE FROM tracked_profiles WHERE id = $1 AND brand_id = $2 AND NOT is_own RETURNING id`, [params.id, brand.id]);
  if (!rows.length) throw notFound("Perfil não encontrado (o perfil da marca não pode ser removido).");
  return json({ ok: true });
}, { role: "editor" });
