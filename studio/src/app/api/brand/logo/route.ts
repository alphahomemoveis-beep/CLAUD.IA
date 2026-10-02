import { json, route } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { getBrand, updateBrand } from "@/lib/repo/brand";
import { newKey, storage } from "@/lib/storage";
import { serveFile } from "@/lib/serve-file";
import { detectFile } from "@/lib/uploads";

export const GET = route(async () => serveFile((await getBrand()).logo_file_key));

export const POST = route(async ({ req }) => {
  const brand = await getBrand();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Envie a logo no campo 'file'.");
  if (file.size > 5 * 1024 * 1024) throw badRequest("A logo deve ter no máximo 5 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const detected = detectFile(buf);
  if (!detected || detected.kind !== "image") throw badRequest("Envie a logo em PNG, JPG ou WEBP.");
  const key = newKey("marca", detected.ext);
  await storage().put(key, buf, detected.mime);
  if (brand.logo_file_key) await storage().remove(brand.logo_file_key).catch(() => undefined);
  await updateBrand(brand.id, { logo_file_key: key });
  return json({ ok: true });
}, { role: "owner", rate: "upload" });
