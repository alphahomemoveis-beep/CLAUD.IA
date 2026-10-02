import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { buildWidget, refreshIfStale } from "@/lib/journal/service";

export const maxDuration = 300;

/**
 * Widget do Instagram. Antes de responder, atualiza os dados se a última
 * sincronização tiver mais de 3 horas. ?atualizar=1 força (donos e gerentes).
 */
export const GET = route(async ({ req, user }) => {
  const brand = await getBrand();
  const force = req.nextUrl.searchParams.get("atualizar") === "1" && user.role !== "viewer";
  const refresh = await refreshIfStale(brand, force);
  return json({ ...(await buildWidget(brand)), refresh });
});
