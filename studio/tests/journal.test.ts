import { describe, expect, it } from "vitest";
import { computeKpis, fmtPct, kpi, periods, ranking, type DayRow } from "@/lib/journal/compute";

const row = (day: string, followers: number | null, reach: number | null = null): DayRow =>
  ({ day, followers, reach, impressions: null, views: null, profile_views: null, interactions: null });

describe("jornal: variações", () => {
  it("monta período atual e anterior de mesmo tamanho", () => {
    expect(periods("2026-10-07", 7)).toEqual({ start: "2026-10-01", end: "2026-10-07", prevStart: "2026-09-24", prevEnd: "2026-09-30" });
  });
  it("seguidores comparam o último valor de cada período", () => {
    const rows = [row("2026-09-29", 1000), row("2026-09-30", 1000), row("2026-10-03", 1010), row("2026-10-07", 1025)];
    const k = computeKpis(rows, "2026-10-07", 7);
    expect(k.seguidores).toMatchObject({ atual: 1025, anterior: 1000, variacao: 25, variacao_pct: 2.5, direcao: "sobe" });
  });
  it("alcance compara a soma de cada período", () => {
    const rows = [row("2026-09-25", null, 100), row("2026-09-26", null, 100), row("2026-10-02", null, 150), row("2026-10-03", null, 50)];
    expect(computeKpis(rows, "2026-10-07", 7).reach).toMatchObject({ atual: 200, anterior: 200, direcao: "estavel", variacao_pct: 0 });
  });
  it("sem período anterior não inventa variação", () => {
    expect(kpi(500, null)).toMatchObject({ direcao: "sem_dados", variacao_pct: null });
    expect(kpi(null, 10).direcao).toBe("sem_dados");
  });
  it("queda vira seta para baixo", () => {
    expect(kpi(95, 100)).toMatchObject({ direcao: "cai", variacao_pct: -5 });
  });
  it("formata percentual em português com sinal", () => {
    expect(fmtPct(2.5)).toBe("+2,5%");
    expect(fmtPct(-1)).toBe("-1,0%");
    expect(fmtPct(null)).toBe("—");
  });
});

describe("jornal: ranking", () => {
  it("ordena por seguidores e calcula o crescimento", () => {
    const r = ranking([
      { id: "a", handle: "alphahome.moveis", name: "AlphaHome", is_own: true, rows: [{ day: "2026-09-30", followers: 900 }, { day: "2026-10-07", followers: 1000 }] },
      { id: "b", handle: "concorrente", name: "Outra", is_own: false, rows: [{ day: "2026-09-30", followers: 5000 }, { day: "2026-10-07", followers: 5050 }] },
      { id: "c", handle: "sem.dados", name: "", is_own: false, rows: [] },
    ], "2026-10-07", 7);
    expect(r.map((x) => [x.posicao, x.handle])).toEqual([[1, "concorrente"], [2, "alphahome.moveis"]]);
    expect(r[1].crescimento.variacao_pct).toBe(11.1);
  });
});

describe("widget: atualização a cada 3 horas", () => {
  const h = 3600_000;
  const now = Date.parse("2026-10-02T15:00:00Z");
  it("sem sincronização anterior, está velho", async () => {
    const { isStale } = await import("@/lib/journal/compute");
    expect(isStale(null, now)).toBe(true);
  });
  it("2h59 depois ainda está fresco; 3h depois precisa atualizar", async () => {
    const { isStale } = await import("@/lib/journal/compute");
    expect(isStale(new Date(now - (3 * h - 60_000)).toISOString(), now)).toBe(false);
    expect(isStale(new Date(now - 3 * h).toISOString(), now)).toBe(true);
  });
  it("próxima atualização é a última + 3h, nunca no passado", async () => {
    const { nextRefreshAt } = await import("@/lib/journal/compute");
    expect(nextRefreshAt(new Date(now - h).toISOString(), now)).toBe(new Date(now + 2 * h).toISOString());
    expect(nextRefreshAt(new Date(now - 5 * h).toISOString(), now)).toBe(new Date(now).toISOString());
  });
});
