import { json, route } from "@/lib/api";
import { queryOne, tx } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getMasterPrompt, listMasterPrompts } from "@/lib/repo/prompts";

/** Duplica a versão ativa (ou a mais recente) num prompt novo, desligado. */
export const POST = route<{ id: string }>(async ({ params, user }) => {
  const brand = await getBrand();
  const mp = await getMasterPrompt(params.id, brand.id);
  if (!mp) throw notFound("Prompt não encontrado.");
  const source = await queryOne<{ content: string; version: number }>(
    `SELECT content, version FROM prompt_versions WHERE master_prompt_id = $1 ORDER BY is_active DESC, version DESC LIMIT 1`, [mp.id]);
  if (!source) throw notFound("O prompt não tem versões para duplicar.");
  await tx(async (db) => {
    const m = await db.query<{ id: string }>(
      `INSERT INTO master_prompts (brand_id, title, description, enabled, sort_order, created_by)
       VALUES ($1,$2,$3,false,$4,$5) RETURNING id`,
      [brand.id, `Cópia de ${mp.title}`.slice(0, 120), mp.description, mp.sort_order + 1, user.id],
    );
    await db.query(
      `INSERT INTO prompt_versions (master_prompt_id, version, content, notes, is_active, created_by) VALUES ($1,1,$2,$3,true,$4)`,
      [m.rows[0].id, source.content, `Duplicado de "${mp.title}" v${source.version}`, user.id],
    );
  });
  return json({ prompts: await listMasterPrompts(brand.id) }, 201);
}, { role: "owner" });
