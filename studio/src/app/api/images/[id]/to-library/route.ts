import { json, route } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getImage } from "@/lib/repo/projects";
import { mimeFromKey, newKey, storage } from "@/lib/storage";
import { analyzeReference } from "@/lib/studio/references";
import { logActivity } from "@/lib/activity";

export const maxDuration = 120;

/** Leva uma criação aprovada para a biblioteca, como referência em avaliação. */
export const POST = route<{ id: string }>(async ({ params, user }) => {
  const brand = await getBrand();
  const image = await getImage(params.id, brand.id);
  if (!image?.file_key) throw notFound("Imagem não encontrada.");
  const mime = mimeFromKey(image.file_key);
  if (!mime.startsWith("image/") || mime === "image/svg+xml") throw conflict("Só imagens reais podem ir para a biblioteca.");
  const data = await storage().get(image.file_key);
  if (!data) throw notFound("Arquivo não encontrado.");
  const key = newKey("referencias", image.file_key.split(".").pop()!);
  await storage().put(key, data, mime);
  const ref = await queryOne<{ id: string }>(
    `INSERT INTO visual_references (brand_id, name, category, status, media_type, mime_type, file_key, file_size, source, user_notes, created_by)
     VALUES ($1,$2,'instagram','em_avaliacao','image',$3,$4,$5,'gerada',$6,$7) RETURNING id`,
    [brand.id, `Criação ${image.slide_role} v${image.version}`, mime, key, data.length, "Criada no estúdio e enviada para a biblioteca.", user.id],
  );
  await logActivity(user.id, "criacao_para_biblioteca", "visual_references", ref!.id);
  const analyzed = await analyzeReference(ref!.id);
  return json({ reference: analyzed }, 201);
}, { role: "editor", rate: "ai" });
