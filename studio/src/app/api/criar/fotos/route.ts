import { z } from "zod";
import { json, route } from "@/lib/api";
import { searchStock } from "@/lib/criar/pexels";

const Query = z.object({ q: z.string().trim().min(2).max(80), tipo: z.enum(["foto", "video"]).default("foto") });

/** Busca no Pexels (fotos e vídeos gratuitos). */
export const GET = route(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const q = Query.parse({ q: sp.get("q") ?? "", tipo: sp.get("tipo") ?? undefined });
  return json({ itens: await searchStock(q.q, q.tipo) });
}, { role: "editor" });
