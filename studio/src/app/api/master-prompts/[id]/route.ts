import { z } from "zod";
import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getMasterPrompt, listMasterPrompts } from "@/lib/repo/prompts";
import { logActivity } from "@/lib/activity";

type P = { id: string };

const Patch = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
});

export const PATCH = route<P>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const mp = await getMasterPrompt(params.id, brand.id);
  if (!mp) throw notFound("Prompt não encontrado.");
  const b = Patch.parse(await req.json());
  await query(
    `UPDATE master_prompts SET title = COALESCE($1,title), description = COALESCE($2,description),
            enabled = COALESCE($3,enabled), sort_order = COALESCE($4,sort_order), updated_at = now() WHERE id = $5`,
    [b.title ?? null, b.description ?? null, b.enabled ?? null, b.sort_order ?? null, mp.id],
  );
  if (b.enabled !== undefined) await logActivity(user.id, b.enabled ? "prompt_mestre_ligado" : "prompt_mestre_desligado", "master_prompts", mp.id);
  return json({ prompts: await listMasterPrompts(brand.id) });
}, { role: "owner" });

/** Apaga o prompt e todas as versões. Exige confirmação explícita. */
export const DELETE = route<P>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const mp = await getMasterPrompt(params.id, brand.id);
  if (!mp) throw notFound("Prompt não encontrado.");
  if (req.nextUrl.searchParams.get("confirmar") !== mp.title) {
    throw badRequest("Para apagar o prompt e todas as versões, confirme digitando o título exato.");
  }
  await query(`DELETE FROM master_prompts WHERE id = $1`, [mp.id]);
  await logActivity(user.id, "prompt_mestre_apagado", "master_prompts", mp.id, { titulo: mp.title });
  return json({ prompts: await listMasterPrompts(brand.id) });
}, { role: "owner" });
