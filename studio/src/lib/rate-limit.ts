/**
 * Limite de requisições em memória por janela deslizante.
 * Vale por instância do servidor. Para várias instâncias, troque por Redis.
 */
const buckets = new Map<string, number[]>();

export interface RateRule {
  limit: number;
  windowMs: number;
}

export const RATE_RULES = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  ai: { limit: 40, windowMs: 10 * 60_000 },
  image: { limit: 30, windowMs: 60 * 60_000 },
  upload: { limit: 60, windowMs: 10 * 60_000 },
  default: { limit: 300, windowMs: 60_000 },
} satisfies Record<string, RateRule>;

export function checkRate(key: string, rule: RateRule, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (hits.length >= rule.limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.ceil((rule.windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < rule.windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
