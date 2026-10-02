import "server-only";
import { env } from "../env";
import { log } from "../logger";

/**
 * Windsor.ai: dados do Instagram da própria conta (seguidores, alcance,
 * impressões, visitas). Endpoint: connectors.windsor.ai/{conector}.
 */
const BASE = "https://connectors.windsor.ai";

/** Campos pedidos por padrão. Pode ser trocado por WINDSOR_INSTAGRAM_FIELDS. */
export const DEFAULT_FIELDS = ["date", "account_id", "user_name", "followers_count", "reach", "impressions", "profile_views", "media_count"];

export function windsorConfigured() {
  return !!env().WINDSOR_API_KEY;
}

export interface WindsorRow {
  date: string;
  account_id?: string;
  user_name?: string;
  [field: string]: unknown;
}

export async function instagramDaily(dateFrom: string, dateTo: string): Promise<WindsorRow[]> {
  const key = env().WINDSOR_API_KEY;
  if (!key) throw new Error("Windsor.ai não configurado. Defina WINDSOR_API_KEY.");
  const fields = (process.env.WINDSOR_INSTAGRAM_FIELDS?.split(",").map((f) => f.trim()).filter(Boolean)) ?? DEFAULT_FIELDS;
  const url = new URL(`${BASE}/instagram`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("date_from", dateFrom);
  url.searchParams.set("date_to", dateTo);
  url.searchParams.set("fields", fields.join(","));
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) {
    log.warn("windsor_erro", { status: res.status, body: text.slice(0, 300) });
    throw new Error(`Windsor.ai respondeu ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text) as { data?: WindsorRow[] };
  return (json.data ?? []).filter((r) => typeof r.date === "string");
}
