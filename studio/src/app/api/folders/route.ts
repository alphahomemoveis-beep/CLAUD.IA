import { z } from "zod";
import { json, route } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { childFolders, getFolder } from "@/lib/repo/folders";
import { logActivity } from "@/lib/activity";

/** Pastas da raiz (ou de uma pasta, com ?pai=). */
export const GET = route(async ({ req }) => {
  const brand = await getBrand();
  const parent = req.nextUrl.searchParams.get("pai");
  return json({ folders: await childFolders(brand.id, parent && /^[0-9a-f-]{36}$/.test(parent) ? parent : null) });
});

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  parent_id: z.string().uuid().nullable().default(null),
  description: z.string().max(2000).default(""),
  address: z.string().max(300).default(""),
  client_name: z.string().max(120).default(""),
});

export const POST = route(async ({ req, user }) => {
  const brand = await getBrand();
  const b = Body.parse(await req.json());
  if (b.parent_id && !(await getFolder(b.parent_id, brand.id))) throw notFound("Pasta de origem não encontrada.");
  try {
    const folder = await queryOne(
      `INSERT INTO folders (brand_id, parent_id, name, description, address, client_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [brand.id, b.parent_id, b.name, b.description, b.address, b.client_name, user.id],
    );
    await logActivity(user.id, "pasta_criada", "folders", (folder as { id: string }).id, { nome: b.name });
    return json({ folder }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw conflict(`Já existe uma pasta chamada "${b.name}" aqui.`);
    throw err;
  }
}, { role: "editor" });
