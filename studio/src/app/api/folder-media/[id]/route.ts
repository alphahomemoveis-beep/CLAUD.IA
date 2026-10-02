import { z } from "zod";
import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getFolder, getMedia, STAGES } from "@/lib/repo/folders";
import { storage } from "@/lib/storage";
import { logActivity } from "@/lib/activity";

type P = { id: string };

const Patch = z.object({
  caption: z.string().max(2000).optional(),
  stage: z.enum(STAGES).optional(),
  folder_id: z.string().uuid().optional(),
});

export const PATCH = route<P>(async ({ params, req }) => {
  const brand = await getBrand();
  const media = await getMedia(params.id, brand.id);
  if (!media) throw notFound("Mídia não encontrada.");
  const b = Patch.parse(await req.json());
  if (b.folder_id && !(await getFolder(b.folder_id, brand.id))) throw notFound("Pasta de destino não encontrada.");
  const rows = await query(
    `UPDATE folder_media SET caption = COALESCE($1, caption), stage = COALESCE($2, stage), folder_id = COALESCE($3, folder_id)
      WHERE id = $4 RETURNING id, folder_id, stage, media_type, mime_type, file_size, original_name, caption, reference_id, created_at`,
    [b.caption ?? null, b.stage ?? null, b.folder_id ?? null, media.id],
  );
  return json({ media: rows[0] });
}, { role: "editor" });

export const DELETE = route<P>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const media = await getMedia(params.id, brand.id);
  if (!media) throw notFound("Mídia não encontrada.");
  if (req.nextUrl.searchParams.get("confirmar") !== "sim") throw badRequest("Confirme a exclusão da mídia.");
  const used = await query(`SELECT id FROM scheduled_posts WHERE $1 = ANY(media_ids) AND status IN ('rascunho','agendado')`, [media.id]);
  if (used.length) throw badRequest("Esta mídia está num post agendado. Cancele o post antes de apagar.");
  await query(`DELETE FROM folder_media WHERE id = $1`, [media.id]);
  await storage().remove(media.file_key).catch(() => undefined);
  await logActivity(user.id, "midia_apagada", "folder_media", media.id, { arquivo: media.original_name });
  return json({ ok: true });
}, { role: "editor" });
