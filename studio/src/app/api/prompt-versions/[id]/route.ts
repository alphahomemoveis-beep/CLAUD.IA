import { z } from "zod";
import { json, route } from "@/lib/api";
import { query, tx } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getVersion, listMasterPrompts } from "@/lib/repo/prompts";
import { logActivity } from "@/lib/activity";

type P = { id: string };

const Patch = z.object({ active: z.boolean() });

/** Ativa uma versão (desativando as outras do mesmo prompt) ou desativa. */
export const PATCH = route<P>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const v = await getVersion(params.id, brand.id);
  if (!v) throw notFound("Versão não encontrada.");
  const { active } = Patch.parse(await req.json());
  await tx(async (db) => {
    if (active) await db.query(`UPDATE prompt_versions SET is_active = false WHERE master_prompt_id = $1`, [v.master_prompt_id]);
    await db.query(`UPDATE prompt_versions SET is_active = $1 WHERE id = $2`, [active, v.id]);
  });
  await logActivity(user.id, active ? "versao_ativada" : "versao_desativada", "prompt_versions", v.id, { versao: v.version });
  return json({ prompts: await listMasterPrompts(brand.id) });
}, { role: "owner" });

/** Nunca apaga sem confirmação, nunca apaga a versão ativa nem a única versão. */
export const DELETE = route<P>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const v = await getVersion(params.id, brand.id);
  if (!v) throw notFound("Versão não encontrada.");
  if (req.nextUrl.searchParams.get("confirmar") !== `v${v.version}`) throw badRequest(`Confirme a exclusão digitando v${v.version}.`);
  if (v.is_active) throw conflict("Esta é a versão ativa. Ative outra versão antes de apagar esta.");
  const count = (await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM prompt_versions WHERE master_prompt_id = $1`, [v.master_prompt_id]))[0].n;
  if (count <= 1) throw conflict("Esta é a única versão do prompt.");
  await query(`DELETE FROM prompt_versions WHERE id = $1`, [v.id]);
  await logActivity(user.id, "versao_apagada", "prompt_versions", v.id, { versao: v.version, conteudo: v.content.slice(0, 300) });
  return json({ prompts: await listMasterPrompts(brand.id) });
}, { role: "owner" });
