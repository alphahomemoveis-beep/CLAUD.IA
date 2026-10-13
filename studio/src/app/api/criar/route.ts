import { z } from "zod";
import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { aiEnabled, AI_OFF_MESSAGE } from "@/lib/ai";
import { AppError } from "@/lib/errors";
import { FORMATS } from "@/lib/criar/schemas";
import { createCreation, listCreations } from "@/lib/criar/service";
import { pexelsEnabled } from "@/lib/criar/pexels";

export const GET = route(async () => {
  const brand = await getBrand();
  return json({ creations: await listCreations(brand.id), aiEnabled: aiEnabled(), pexels: pexelsEnabled(), hasLogo: !!brand.logo_file_key });
});

const Body = z.object({ format: z.enum(FORMATS), tema: z.string().max(600).default("") });

/** Começa uma criação: a IA pesquisa o que está em alta e traz 3 opções. */
export const POST = route(async ({ req, user }) => {
  if (!aiEnabled()) throw new AppError(503, AI_OFF_MESSAGE, "ia_indisponivel");
  const b = Body.parse(await req.json());
  const brand = await getBrand();
  const c = await createCreation(brand, user.id, b.format, b.tema);
  return json({ id: c.id }, 202);
}, { role: "editor", rate: "ai" });
