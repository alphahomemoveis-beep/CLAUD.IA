import { z } from "zod";
import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { breadcrumb, childFolders, getFolder, isDescendant, listMedia, mediaKeysUnder } from "@/lib/repo/folders";
import { storage } from "@/lib/storage";
import { logActivity } from "@/lib/activity";

type P = { id: string };

export const GET = route<P>(async ({ params }) => {
  const brand = await getBrand();
  const folder = await getFolder(params.id, brand.id);
  if (!folder) throw notFound("Pasta não encontrada.");
  const [path, children, media] = await Promise.all([breadcrumb(folder.id), childFolders(brand.id, folder.id), listMedia(folder.id)]);
  return json({ folder, path, children, media: media.map(({ file_key: _k, ...m }) => m) });
});

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  address: z.string().max(300).optional(),
  client_name: z.string().max(120).optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

export const PATCH = route<P>(async ({ params, req }) => {
  const brand = await getBrand();
  const folder = await getFolder(params.id, brand.id);
  if (!folder) throw notFound("Pasta não encontrada.");
  const b = Patch.parse(await req.json());
  if (b.parent_id !== undefined && b.parent_id !== null) {
    if (!(await getFolder(b.parent_id, brand.id))) throw notFound("Pasta de destino não encontrada.");
    if (await isDescendant(folder.id, b.parent_id)) throw badRequest("Não dá para mover uma pasta para dentro dela mesma.");
  }
  try {
    const rows = await query(
      `UPDATE folders SET name = COALESCE($1, name), description = COALESCE($2, description), address = COALESCE($3, address),
              client_name = COALESCE($4, client_name),
              parent_id = CASE WHEN $5::boolean THEN $6::uuid ELSE parent_id END, updated_at = now()
        WHERE id = $7 RETURNING *`,
      [b.name ?? null, b.description ?? null, b.address ?? null, b.client_name ?? null, b.parent_id !== undefined, b.parent_id ?? null, folder.id],
    );
    return json({ folder: rows[0] });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw conflict("Já existe uma pasta com esse nome no destino.");
    throw err;
  }
}, { role: "editor" });

/** Apaga a pasta, as subpastas e todas as mídias. Exige digitar o nome. */
export const DELETE = route<P>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const folder = await getFolder(params.id, brand.id);
  if (!folder) throw notFound("Pasta não encontrada.");
  if (req.nextUrl.searchParams.get("confirmar") !== folder.name) {
    throw badRequest("Para apagar a pasta com tudo o que tem dentro, confirme digitando o nome exato da pasta.");
  }
  const keys = await mediaKeysUnder(folder.id);
  await query(`DELETE FROM folders WHERE id = $1`, [folder.id]);
  await Promise.all(keys.map((k) => storage().remove(k.file_key).catch(() => undefined)));
  await logActivity(user.id, "pasta_apagada", "folders", folder.id, { nome: folder.name, arquivos: keys.length });
  return json({ ok: true, removed: keys.length });
}, { role: "owner" });
