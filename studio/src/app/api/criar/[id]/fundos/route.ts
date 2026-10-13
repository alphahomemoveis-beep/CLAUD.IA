import { z } from "zod";
import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { badRequest } from "@/lib/errors";
import { getMedia } from "@/lib/repo/folders";
import { detectFile } from "@/lib/uploads";
import { env } from "@/lib/env";
import { setBackground } from "@/lib/criar/service";
import { autoBackgrounds, backgroundFromStock, storeBackground } from "@/lib/criar/produce";

const Body = z.discriminatedUnion("origem", [
  z.object({ origem: z.literal("pasta"), peca: z.number().int().min(0).max(20), mediaId: z.string().uuid() }),
  z.object({ origem: z.literal("banco"), peca: z.number().int().min(0).max(20), bancoId: z.number().int().positive(), tipo: z.enum(["foto", "video"]) }),
  z.object({ origem: z.literal("remover"), peca: z.number().int().min(0).max(20) }),
  z.object({ origem: z.literal("auto") }),
]);

/**
 * Fundo de uma peça: arquivo enviado (multipart com "peca" e "file"), mídia
 * das Pastas, foto ou vídeo do banco de imagens (Pixabay ou Pexels), ou "auto"
 * para completar pelo banco.
 */
export const POST = route<{ id: string }>(async ({ req, params }) => {
  const brand = await getBrand();
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const peca = Number(form.get("peca"));
    if (!(file instanceof File) || !Number.isInteger(peca)) throw badRequest("Envie a imagem no campo 'file' e o número da peça em 'peca'.");
    if (file.size > env().FOLDER_MAX_UPLOAD_MB * 1024 * 1024) throw badRequest(`O arquivo passa de ${env().FOLDER_MAX_UPLOAD_MB} MB.`);
    const buf = Buffer.from(await file.arrayBuffer());
    const d = detectFile(buf);
    if (!d) throw badRequest("Envie JPG, PNG, WEBP, MP4, MOV ou WEBM.");
    return json({ fundos: await storeBackground(brand.id, params.id, peca, buf, d.mime, d.kind, { origem: "upload" }) });
  }
  const b = Body.parse(await req.json());
  if (b.origem === "auto") return json({ fundos: await autoBackgrounds(brand.id, params.id) });
  if (b.origem === "remover") return json({ fundos: await setBackground(brand.id, params.id, b.peca, null) });
  if (b.origem === "banco") return json({ fundos: await backgroundFromStock(brand.id, params.id, b.peca, b.bancoId, b.tipo) });
  const media = await getMedia(b.mediaId, brand.id);
  if (!media) throw badRequest("Mídia não encontrada nas Pastas.");
  return json({ fundos: await setBackground(brand.id, params.id, b.peca, { peca: b.peca, origem: "pasta", file_key: media.file_key, media_type: media.media_type }) });
}, { role: "editor", rate: "upload" });
