import { z } from "zod";
import { json, route } from "@/lib/api";
import { effectiveAI, getBrand, updateBrand } from "@/lib/repo/brand";
import { logActivity } from "@/lib/activity";

export const GET = route(async () => {
  const brand = await getBrand();
  const cfg = effectiveAI(brand);
  const { logo_file_key, ...rest } = brand;
  return json({ brand: { ...rest, has_logo: !!logo_file_key }, effective: cfg });
});

const Identity = z.object({
  atributos: z.string().max(500).optional(),
  tom_de_voz: z.string().max(1000).optional(),
  publico: z.string().max(1000).optional(),
  instagram: z.string().max(100).optional(),
  logo_regras: z.string().max(1000).optional(),
  assinatura_regras: z.string().max(1000).optional(),
  assinatura_fantasma: z.boolean().optional(),
  assinatura_fantasma_texto: z.string().max(60).optional(),
  cores_marca: z.array(z.string().max(60)).max(12).optional(),
  evitar: z.string().max(2000).optional(),
});

const ModelName = z.string().regex(/^[a-zA-Z0-9._:-]{0,80}$/, "Nome de modelo inválido");

const AISettings = z.object({
  text_model: ModelName.optional(),
  vision_model: ModelName.optional(),
  image_model: ModelName.optional(),
  image_quality: z.enum(["low", "medium", "high", "xhigh", "max", "auto"]).optional(),
  web_search: z.boolean().optional(),
  concept_count: z.number().int().min(3).max(5).optional(),
  use_reference_images: z.boolean().optional(),
  max_references: z.number().int().min(2).max(12).optional(),
});

const Body = z.object({
  name: z.string().min(1).max(80).optional(),
  positioning: z.string().max(200).optional(),
  identity: Identity.optional(),
  ai_settings: AISettings.optional(),
});

export const PUT = route(async ({ req, user }) => {
  const brand = await getBrand();
  const body = Body.parse(await req.json());
  const updated = await updateBrand(brand.id, {
    name: body.name,
    positioning: body.positioning,
    identity: body.identity ? { ...brand.identity, ...body.identity } : undefined,
    ai_settings: body.ai_settings ? { ...brand.ai_settings, ...body.ai_settings } : undefined,
  });
  await logActivity(user.id, "marca_atualizada", "brand_settings", brand.id, { campos: Object.keys(body) });
  const { logo_file_key, ...rest } = updated;
  return json({ brand: { ...rest, has_logo: !!logo_file_key }, effective: effectiveAI(updated) });
}, { role: "owner" });
