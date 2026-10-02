import { json, route } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { badRequest, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getFolder, STAGES, type FolderStage } from "@/lib/repo/folders";
import { newKey, storage } from "@/lib/storage";
import { ACCEPTED_DESCRIPTION, detectFile } from "@/lib/uploads";
import { logActivity } from "@/lib/activity";

export const maxDuration = 300;

/** Envio de fotos e vídeos para Projeto, Obra ou Resultado. Aceita vários arquivos. */
export const POST = route<{ id: string }>(async ({ params, req, user, ip }) => {
  const brand = await getBrand();
  const folder = await getFolder(params.id, brand.id);
  if (!folder) throw notFound("Pasta não encontrada.");
  const form = await req.formData();
  const stage = String(form.get("stage") ?? "") as FolderStage;
  if (!STAGES.includes(stage)) throw badRequest("Escolha a etapa: projeto, obra ou resultado.");
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw badRequest("Envie pelo menos um arquivo.");
  if (files.length > 30) throw badRequest("Envie no máximo 30 arquivos por vez.");
  const maxBytes = env().FOLDER_MAX_UPLOAD_MB * 1024 * 1024;

  const created: unknown[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  for (const file of files) {
    if (file.size > maxBytes) { rejected.push({ name: file.name, reason: `maior que ${env().FOLDER_MAX_UPLOAD_MB} MB` }); continue; }
    if (file.size === 0) { rejected.push({ name: file.name, reason: "arquivo vazio" }); continue; }
    const buf = Buffer.from(await file.arrayBuffer());
    const detected = detectFile(buf);
    if (!detected) { rejected.push({ name: file.name, reason: `formato não aceito (${ACCEPTED_DESCRIPTION})` }); continue; }
    const key = newKey("pastas", detected.ext);
    await storage().put(key, buf, detected.mime);
    const row = await queryOne(
      `INSERT INTO folder_media (brand_id, folder_id, stage, media_type, mime_type, file_key, file_size, original_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, folder_id, stage, media_type, mime_type, file_size, original_name, caption, reference_id, created_at`,
      [brand.id, folder.id, stage, detected.kind, detected.mime, key, buf.length, file.name.slice(0, 200), user.id],
    );
    created.push(row);
  }
  await queryOne(`UPDATE folders SET updated_at = now() WHERE id = $1`, [folder.id]);
  await logActivity(user.id, "midias_enviadas", "folders", folder.id, { etapa: stage, enviadas: created.length, recusadas: rejected.length }, ip);
  return json({ created, rejected }, created.length ? 201 : 400);
}, { role: "editor", rate: "upload" });
