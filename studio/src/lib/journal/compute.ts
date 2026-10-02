/**
 * Cálculos do jornal, sem banco nem IA.
 * Seguidores é um estoque: compara o último valor do período com o último
 * valor antes dele. Alcance, impressões e visualizações são fluxos: compara
 * a soma do período com a soma do período anterior de mesmo tamanho.
 */

export interface DayRow {
  day: string; // AAAA-MM-DD
  followers: number | null;
  reach: number | null;
  impressions: number | null;
  views: number | null;
  profile_views: number | null;
  interactions: number | null;
}

export interface Kpi {
  atual: number | null;
  anterior: number | null;
  variacao: number | null;
  variacao_pct: number | null;
  direcao: "sobe" | "cai" | "estavel" | "sem_dados";
}

export const FLOW_METRICS = ["reach", "impressions", "views", "profile_views", "interactions"] as const;
export type FlowMetric = (typeof FLOW_METRICS)[number];

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Período atual e anterior com o mesmo número de dias. */
export function periods(end: string, days: number) {
  const start = addDays(end, -(days - 1));
  return { start, end, prevStart: addDays(start, -days), prevEnd: addDays(start, -1) };
}

export function kpi(atual: number | null, anterior: number | null): Kpi {
  if (atual == null) return { atual, anterior, variacao: null, variacao_pct: null, direcao: "sem_dados" };
  if (anterior == null) return { atual, anterior, variacao: null, variacao_pct: null, direcao: "sem_dados" };
  const variacao = atual - anterior;
  const variacao_pct = anterior === 0 ? (atual === 0 ? 0 : null) : (variacao / anterior) * 100;
  const direcao = Math.abs(variacao_pct ?? (variacao === 0 ? 0 : 1)) < 0.05 ? "estavel" : variacao > 0 ? "sobe" : "cai";
  return { atual, anterior, variacao, variacao_pct: variacao_pct == null ? null : Math.round(variacao_pct * 10) / 10, direcao };
}

function lastValue(rows: DayRow[], until: string, key: "followers"): number | null {
  let best: DayRow | null = null;
  for (const r of rows) if (r.day <= until && r[key] != null && (!best || r.day > best.day)) best = r;
  return best ? (best[key] as number) : null;
}

function sum(rows: DayRow[], from: string, to: string, key: FlowMetric): number | null {
  const sel = rows.filter((r) => r.day >= from && r.day <= to && r[key] != null);
  return sel.length ? sel.reduce((s, r) => s + (r[key] as number), 0) : null;
}

export function computeKpis(rows: DayRow[], end: string, days: number) {
  const p = periods(end, days);
  const seguidores = kpi(lastValue(rows, p.end, "followers"), lastValue(rows, p.prevEnd, "followers"));
  const flows = Object.fromEntries(FLOW_METRICS.map((m) => [m, kpi(sum(rows, p.start, p.end, m), sum(rows, p.prevStart, p.prevEnd, m))])) as Record<FlowMetric, Kpi>;
  const serie = rows.filter((r) => r.day >= p.start && r.day <= p.end && r.followers != null)
    .sort((a, b) => a.day.localeCompare(b.day)).map((r) => ({ day: r.day, followers: r.followers as number }));
  return { periodo: p, seguidores, ...flows, serie };
}

export interface RankInput { id: string; handle: string; name: string; is_own: boolean; rows: Array<{ day: string; followers: number | null }> }

/** Ranking por seguidores no fim do período, com o crescimento no período. */
export function ranking(profiles: RankInput[], end: string, days: number) {
  const p = periods(end, days);
  return profiles
    .map((pr) => {
      const asRows = pr.rows.map((r) => ({ day: r.day, followers: r.followers, reach: null, impressions: null, views: null, profile_views: null, interactions: null }));
      const atual = lastValue(asRows, p.end, "followers");
      const k = kpi(atual, lastValue(asRows, p.prevEnd, "followers"));
      return { id: pr.id, handle: pr.handle, name: pr.name, is_own: pr.is_own, seguidores: atual, crescimento: k };
    })
    .filter((r) => r.seguidores != null)
    .sort((a, b) => (b.seguidores ?? 0) - (a.seguidores ?? 0))
    .map((r, i) => ({ ...r, posicao: i + 1 }));
}

/** "2,5%" com sinal, para manchetes e cartões. */
export function fmtPct(v: number | null) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}
