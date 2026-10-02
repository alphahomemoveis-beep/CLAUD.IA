import "server-only";
import { env } from "../env";
import { log } from "../logger";

/**
 * Cliente da API REST do Metricool (plano com acesso à API).
 * Autenticação: token no cabeçalho X-Mc-Auth, userId e blogId na URL.
 * Os endpoints seguem a documentação pública do Metricool; os formatos de
 * resposta variam por plano, por isso a leitura é tolerante.
 */
const BASE = "https://app.metricool.com/api";

export class MetricoolError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export function metricoolConfig(blogIdOverride?: string | null) {
  const e = env();
  const blogId = blogIdOverride || e.METRICOOL_BLOG_ID;
  if (!e.METRICOOL_USER_TOKEN || !e.METRICOOL_USER_ID) return null;
  return { token: e.METRICOOL_USER_TOKEN, userId: e.METRICOOL_USER_ID, blogId: blogId ?? null };
}

async function request<T = unknown>(path: string, init: RequestInit & { blogId?: string | null; query?: Record<string, string> } = {}): Promise<T> {
  const cfg = metricoolConfig(init.blogId);
  if (!cfg) throw new MetricoolError("Metricool não configurado. Defina METRICOOL_USER_TOKEN e METRICOOL_USER_ID.");
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("userId", cfg.userId);
  if (cfg.blogId) url.searchParams.set("blogId", cfg.blogId);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    ...init,
    headers: { "X-Mc-Auth": cfg.token, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) {
    log.warn("metricool_erro", { path, status: res.status, body: text.slice(0, 300) });
    throw new MetricoolError(`Metricool respondeu ${res.status}: ${text.slice(0, 200) || res.statusText}`, res.status);
  }
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    return text as T;
  }
}

/** Marcas (perfis) da conta, para escolher o blogId. */
export async function listBrands() {
  const data = await request<unknown>("/admin/simpleProfiles");
  const list = (Array.isArray(data) ? data : ((data as { data?: unknown[] })?.data ?? [])) as Array<Record<string, unknown>>;
  return list.map((b) => ({
    blogId: String(b.id ?? b.blogId ?? ""),
    label: String(b.label ?? b.title ?? b.name ?? b.id ?? ""),
    instagram: (b.instagram ?? b.instagramUsername ?? null) as string | null,
  })).filter((b) => b.blogId);
}

/** Imagens passam pelo normalizador do Metricool, que guarda uma cópia. */
export async function normalizeImageUrl(url: string, blogId?: string | null) {
  try {
    const out = await request<unknown>("/actions/normalize/image/url", { blogId, query: { url } });
    if (typeof out === "string" && out.startsWith("http")) return out;
    const v = (out as { url?: string; data?: string })?.url ?? (out as { data?: string })?.data;
    return typeof v === "string" && v.startsWith("http") ? v : url;
  } catch (err) {
    log.warn("metricool_normalizar_falhou", { err });
    return url;
  }
}

export async function createScheduledPost(body: Record<string, unknown>, blogId?: string | null): Promise<string | null> {
  const out = await request<Record<string, unknown>>("/v2/scheduler/posts", { method: "POST", body: JSON.stringify(body), blogId });
  const data = (out?.data ?? out) as Record<string, unknown> | undefined;
  const id = data?.id ?? data?.postId ?? out?.id;
  return id != null ? String(id) : null;
}

export async function updateScheduledPost(id: string, body: Record<string, unknown>, blogId?: string | null) {
  await request(`/v2/scheduler/posts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body), blogId });
}

export async function deleteScheduledPost(id: string, blogId?: string | null) {
  await request(`/v2/scheduler/posts/${encodeURIComponent(id)}`, { method: "DELETE", blogId });
}

export interface RemotePostState { id: string; published: boolean; failed: boolean; raw: Record<string, unknown> }

/** Situação dos posts no planejador, para saber o que já foi publicado. */
export async function listScheduledPosts(startLocal: string, endLocal: string, timezone: string, blogId?: string | null): Promise<RemotePostState[]> {
  const out = await request<unknown>("/v2/scheduler/posts", { blogId, query: { start: startLocal, end: endLocal, timezone } });
  const list = (Array.isArray(out) ? out : ((out as { data?: unknown[] })?.data ?? [])) as Array<Record<string, unknown>>;
  return list.map((p) => {
    const flat = JSON.stringify(p).toUpperCase();
    return {
      id: String(p.id ?? ""),
      published: /"(STATUS|PUBLICATIONSTATUS|STATE)":"(PUBLISHED|PUBLICADO|SENT|DONE)"/.test(flat) || p.published === true,
      failed: /"(STATUS|PUBLICATIONSTATUS|STATE)":"(ERROR|FAILED)"/.test(flat),
      raw: p,
    };
  }).filter((p) => p.id);
}

/** Série diária de uma métrica (endpoints de estatísticas: datas AAAAMMDD). */
export async function timeline(metric: string, startYmd: string, endYmd: string, blogId?: string | null): Promise<Array<{ day: string; value: number }>> {
  const out = await request<unknown>(`/stats/timeline/${encodeURIComponent(metric)}`, { blogId, query: { start: startYmd, end: endYmd } });
  const list = (Array.isArray(out) ? out : ((out as { data?: unknown[] })?.data ?? [])) as unknown[];
  const rows: Array<{ day: string; value: number }> = [];
  for (const item of list) {
    let rawDay: unknown;
    let rawVal: unknown;
    if (Array.isArray(item)) [rawDay, rawVal] = item;
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      rawDay = o.date ?? o.day ?? o.dateTime ?? o.x;
      rawVal = o.value ?? o.y ?? o.count;
    }
    const day = toIsoDay(rawDay);
    const value = Number(rawVal);
    if (day && Number.isFinite(value)) rows.push({ day, value });
  }
  return rows;
}

export interface Competitor { id: string; handle: string; name: string; followers: number | null }

/** Concorrentes cadastrados no Metricool com seguidores atuais. */
export async function competitors(network = "instagram", blogId?: string | null): Promise<Competitor[]> {
  const out = await request<unknown>(`/v2/analytics/competitors/${network}`, { blogId });
  const list = (Array.isArray(out) ? out : ((out as { data?: unknown[] })?.data ?? [])) as Array<Record<string, unknown>>;
  return list.map((c) => ({
    id: String(c.id ?? c.competitorId ?? ""),
    handle: String(c.username ?? c.screenName ?? c.handle ?? c.name ?? "").replace(/^@/, ""),
    name: String(c.name ?? c.displayName ?? c.username ?? ""),
    followers: num(c.followers ?? c.followersCount ?? c.followers_count ?? (c.metrics as Record<string, unknown> | undefined)?.followers),
  })).filter((c) => c.handle);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
}

export function toIsoDay(v: unknown): string | null {
  if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
