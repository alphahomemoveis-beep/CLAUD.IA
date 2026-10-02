import { z } from "zod";
import { json, route } from "@/lib/api";
import { tx } from "@/lib/db";
import { getBrand } from "@/lib/repo/brand";
import { listMasterPrompts } from "@/lib/repo/prompts";
import { logActivity } from "@/lib/activity";

export const GET = route(async () => {
  const brand = await getBrand();
  return json({ prompts: await listMasterPrompts(brand.id) });
});

const Body = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(""),
  content: z.string().trim().min(1).max(60_000),
});

export const POST = route(async ({ req, user }) => {
  const brand = await getBrand();
  const body = Body.parse(await req.json());
  const id = await tx(async (db) => {
    const order = (await db.query<{ n: number }>(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM master_prompts WHERE brand_id = $1`, [brand.id])).rows[0].n;
    const m = await db.query<{ id: string }>(
      `INSERT INTO master_prompts (brand_id, title, description, sort_order, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [brand.id, body.title, body.description, order, user.id],
    );
    await db.query(
      `INSERT INTO prompt_versions (master_prompt_id, version, content, notes, is_active, created_by) VALUES ($1,1,$2,'Versão inicial',true,$3)`,
      [m.rows[0].id, body.content, user.id],
    );
    return m.rows[0].id;
  });
  await logActivity(user.id, "prompt_mestre_criado", "master_prompts", id);
  return json({ prompts: await listMasterPrompts(brand.id) }, 201);
}, { role: "owner" });
