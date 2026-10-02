import { z } from "zod";
import { json, route } from "@/lib/api";
import { tx } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getMasterPrompt, listMasterPrompts } from "@/lib/repo/prompts";
import { logActivity } from "@/lib/activity";

const Body = z.object({
  content: z.string().trim().min(1).max(60_000),
  notes: z.string().max(500).default(""),
  activate: z.boolean().default(true),
});

/** Editar = criar nova versão. A versão anterior nunca é sobrescrita. */
export const POST = route<{ id: string }>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const mp = await getMasterPrompt(params.id, brand.id);
  if (!mp) throw notFound("Prompt não encontrado.");
  const body = Body.parse(await req.json());
  const version = await tx(async (db) => {
    const v = (await db.query<{ v: number }>(`SELECT COALESCE(MAX(version),0)+1 AS v FROM prompt_versions WHERE master_prompt_id = $1`, [mp.id])).rows[0].v;
    if (body.activate) await db.query(`UPDATE prompt_versions SET is_active = false WHERE master_prompt_id = $1`, [mp.id]);
    await db.query(
      `INSERT INTO prompt_versions (master_prompt_id, version, content, notes, is_active, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [mp.id, v, body.content, body.notes, body.activate, user.id],
    );
    await db.query(`UPDATE master_prompts SET updated_at = now() WHERE id = $1`, [mp.id]);
    return v;
  });
  await logActivity(user.id, "prompt_mestre_nova_versao", "master_prompts", mp.id, { versao: version, ativa: body.activate });
  return json({ prompts: await listMasterPrompts(brand.id) }, 201);
}, { role: "owner" });
