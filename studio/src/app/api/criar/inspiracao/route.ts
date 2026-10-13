import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { aiEnabled, AI_OFF_MESSAGE } from "@/lib/ai";
import { AppError, badRequest } from "@/lib/errors";
import { env } from "@/lib/env";
import { detectFile } from "@/lib/uploads";
import { createFromInspiration } from "@/lib/criar/inspiration";

/**
 * Começa uma criação a partir de um vídeo de inspiração: o arquivo (multipart,
 * campo "file") ou um link do YouTube (campo "url"), com um tema opcional.
 */
export const POST = route(async ({ req, user }) => {
  if (!aiEnabled()) throw new AppError(503, AI_OFF_MESSAGE, "ia_indisponivel");
  const form = await req.formData();
  const tema = String(form.get("tema") ?? "").slice(0, 600);
  const url = String(form.get("url") ?? "").trim();
  const file = form.get("file");
  const brand = await getBrand();
  if (file instanceof File && file.size > 0) {
    if (file.size > env().FOLDER_MAX_UPLOAD_MB * 1024 * 1024) throw badRequest(`O vídeo passa de ${env().FOLDER_MAX_UPLOAD_MB} MB.`);
    const data = Buffer.from(await file.arrayBuffer());
    const d = detectFile(data);
    if (!d || d.kind !== "video") throw badRequest("Envie o vídeo em MP4, MOV ou WEBM.");
    const c = await createFromInspiration(brand, user.id, { video: { data, mime: d.mime, ext: d.ext }, tema });
    return json({ id: c.id }, 202);
  }
  if (!url) throw badRequest("Envie o vídeo de inspiração ou cole o link do YouTube.");
  const c = await createFromInspiration(brand, user.id, { url, tema });
  return json({ id: c.id }, 202);
}, { role: "editor", rate: "ai" });
