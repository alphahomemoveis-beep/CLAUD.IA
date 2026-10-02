import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { listBrands, metricoolConfig } from "@/lib/social/metricool";
import { windsorConfigured } from "@/lib/social/windsor";
import { env } from "@/lib/env";

/** Situação das integrações e marcas do Metricool para escolher o blogId. Nada secreto sai daqui. */
export const GET = route(async ({ req }) => {
  const brand = await getBrand();
  const cfg = metricoolConfig(brand.integrations?.metricool_blog_id);
  const e = env();
  const status = {
    ai: { provider: e.AI_PROVIDER, keySet: e.AI_PROVIDER === "anthropic" ? !!e.ANTHROPIC_API_KEY : e.AI_PROVIDER === "openai" ? !!e.OPENAI_API_KEY : true },
    images: e.IMAGE_PROVIDER,
    embeddings: e.EMBEDDING_PROVIDER,
    metricool: { tokenSet: !!cfg, blogId: cfg?.blogId ?? null },
    windsor: { keySet: windsorConfigured() },
    publicMedia: { appUrl: e.APP_URL ?? null, secretSet: !!e.APP_SECRET },
    cron: { secretSet: !!e.CRON_SECRET },
    timezone: e.APP_TIMEZONE,
    integrations: brand.integrations ?? {},
  };
  let brands: Awaited<ReturnType<typeof listBrands>> = [];
  let brandsError: string | null = null;
  if (cfg && req.nextUrl.searchParams.get("marcas") === "1") {
    try { brands = await listBrands(); } catch (err) { brandsError = (err as Error).message; }
  }
  return json({ status, brands, brandsError });
}, { role: "owner" });
