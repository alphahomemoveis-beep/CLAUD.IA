import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { breadcrumb, getMedia } from "@/lib/repo/folders";
import { newKey, storage } from "@/lib/storage";
import { analyzeReference } from "@/lib/studio/references";
import { logActivity } from "@/lib/activity";

export const maxDuration = 120;

/** Leva uma foto da pasta para a Biblioteca visual, onde ela ensina a estética da marca. */
export const POST = route<{ id: string }>(async ({ params, user }) => {
  const brand = await getBrand();
  const media = await getMedia(params.id, brand.id);
  if (!media) throw notFound("Mídia não encontrada.");
  if (media.reference_id) throw conflict("Esta mídia já está na biblioteca.");
  const data = await storage().get(media.file_key);
  if (!data) throw notFound("Arquivo não encontrado.");
  const path = (await breadcrumb(media.folder_id)).map((p) => p.name).join(" / ");
  const key = newKey("referencias", media.file_key.split(".").pop()!);
  await storage().put(key, data, media.mime_type);
  const ref = await queryOne<{ id: string }>(
    `INSERT INTO visual_references (brand_id, name, category, status, media_type, mime_type, file_key, file_size, user_notes, created_by)
     VALUES ($1,$2,$3,'em_avaliacao',$4,$5,$6,$7,$8,$9) RETURNING id`,
    [brand.id, `${path} · ${media.stage}`.slice(0, 120), media.stage === "resultado" ? "fotografia" : "ambientes",
     media.media_type, media.mime_type, key, data.length, `Trabalho real da AlphaHome (${path}, etapa ${media.stage}). ${media.caption}`.trim(), user.id],
  );
  await query(`UPDATE folder_media SET reference_id = $1 WHERE id = $2`, [ref!.id, media.id]);
  await logActivity(user.id, "midia_para_biblioteca", "folder_media", media.id);
  return json({ reference: await analyzeReference(ref!.id) }, 201);
}, { role: "editor", rate: "ai" });
