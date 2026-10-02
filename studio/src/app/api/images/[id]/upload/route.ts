import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getImage, type ImageRow } from "@/lib/repo/projects";
import { newKey, storage } from "@/lib/storage";
import { detectFile } from "@/lib/uploads";
import { assertPieceIsGeneratable } from "@/lib/studio/generation";
import { logActivity } from "@/lib/activity";

/**
 * Modo manual: a pessoa gera a imagem onde preferir, a partir do prompt
 * final, e envia aqui. A regra absoluta vale do mesmo jeito.
 */
export const POST = route<{ id: string }>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const image = await getImage(params.id, brand.id);
  if (!image) throw notFound("Peça não encontrada.");
  await assertPieceIsGeneratable(image);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Envie a imagem no campo 'file'.");
  if (file.size > 30 * 1024 * 1024) throw badRequest("A imagem deve ter no máximo 30 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const detected = detectFile(buf);
  if (!detected || detected.kind !== "image" || detected.mime === "image/gif") throw badRequest("Envie a peça em JPG, PNG ou WEBP.");
  const key = newKey("geradas", detected.ext);
  await storage().put(key, buf, detected.mime);
  if (image.file_key) await storage().remove(image.file_key).catch(() => undefined);
  const done = await queryOne<ImageRow>(
    `UPDATE generated_images SET status = 'pronta', file_key = $1, provider = 'manual', model = 'enviada pela equipe', size = NULL,
            error = NULL, generated_at = now() WHERE id = $2 RETURNING *`,
    [key, image.id],
  );
  await query(`UPDATE creative_projects SET stage = 'gerado', updated_at = now() WHERE id = $1`, [image.project_id]);
  await logActivity(user.id, "imagem_enviada_manual", "generated_images", image.id);
  const { file_key, ...rest } = done!;
  return json({ image: { ...rest, has_file: !!file_key } });
}, { role: "editor", rate: "upload" });
