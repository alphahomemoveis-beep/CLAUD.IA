"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

interface Kpi { atual: number | null; anterior: number | null; variacao: number | null; variacao_pct: number | null; direcao: "sobe" | "cai" | "estavel" | "sem_dados" }
interface Widget {
  handle: string | null;
  followers: Kpi; followers7: Kpi; reach7: Kpi; views7: Kpi; profileViews7: Kpi;
  spark: Array<{ day: string; followers: number }>;
  ranking: { position: number | null; total: number };
  nextPost: { at: string; type: string; timezone: string } | null;
  upcoming7: number; pendingConfirmation: number;
  lastSyncAt: string | null; lastDataAt: string | null; onlyManual: boolean; lastAttemptAt: string | null; lastError: string | null; nextRefreshAt: string; refreshEveryMs: number;
  integrations: { windsor: boolean; metricool: boolean };
  refresh: { refreshed: boolean; reason: string };
}

const THREE_HOURS = 3 * 60 * 60 * 1000;
const nf = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("pt-BR"));
const TYPE: Record<string, string> = { POST: "Post", CARROSSEL: "Carrossel", REEL: "Reels", STORY: "Story" };

function ago(iso: string | null, now: number) {
  if (!iso) return "nunca";
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;
}

/** Seta, sinal e texto: a cor nunca é a única pista. */
function Delta({ k, suffix }: { k: Kpi; suffix?: string }) {
  if (k.direcao === "sem_dados") return <span className="delta delta-none">sem comparação</span>;
  const cls = k.direcao === "sobe" ? "delta-up" : k.direcao === "cai" ? "delta-down" : "delta-flat";
  const icon = k.direcao === "sobe" ? "▲" : k.direcao === "cai" ? "▼" : "▬";
  const pct = k.variacao_pct == null ? "" : `${k.variacao_pct > 0 ? "+" : ""}${k.variacao_pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return (
    <span className={`delta ${cls}`} title={`Antes: ${nf(k.anterior)}`}>
      <span aria-hidden>{icon}</span> {pct || "0,0%"}
      {k.variacao != null && k.variacao !== 0 && <span className="delta-abs"> ({k.variacao > 0 ? "+" : ""}{nf(k.variacao)})</span>}
      {suffix && <span className="delta-abs"> {suffix}</span>}
    </span>
  );
}

/** Minigráfico de seguidores, 14 dias, com valor ao passar o mouse ou tocar. */
function Spark({ data }: { data: Widget["spark"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (data.length < 2) return <div className="tiny muted spark-empty">Gráfico com 2+ dias de dados</div>;
  const W = 160, H = 44, P = 4;
  const vals = data.map((d) => d.followers);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const x = (i: number) => P + (i / (data.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - min) / (max - min)) * (H - 2 * P);
  const d = data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.followers).toFixed(1)}`).join(" ");
  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const i = Math.round((((clientX - r.left) / r.width) * W - P) / (W - 2 * P) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const h = hover != null ? data[hover] : null;
  return (
    <div className="spark">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img"
        aria-label={`Seguidores nos últimos ${data.length} dias: de ${nf(vals[0])} para ${nf(vals[vals.length - 1])}`}
        onMouseMove={(e) => pick(e.clientX)} onMouseLeave={() => setHover(null)} onTouchMove={(e) => pick(e.touches[0].clientX)} onTouchEnd={() => setHover(null)}>
        <path d={d} fill="none" stroke="var(--chart)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {h && hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--line-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="tiny muted spark-label">{h ? `${new Date(`${h.day}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}: ${nf(h.followers)}` : "Seguidores, 14 dias"}</div>
    </div>
  );
}

/**
 * Widget do Instagram: busca os dados ao abrir, de novo a cada 3 horas e
 * quando a aba volta ao foco depois do horário previsto. O servidor só
 * consulta Windsor.ai e Metricool quando os dados passaram de 3 horas.
 */
export function InstagramWidget({ compact = false }: { compact?: boolean }) {
  const [w, setW] = useState<Widget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setW(await api<Widget>(`/api/widget/instagram${force ? "?atualizar=1" : ""}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const every = setInterval(() => load(), THREE_HOURS);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearInterval(every); clearInterval(tick); };
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && w && Date.now() >= new Date(w.nextRefreshAt).getTime()) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [w, load]);


  const connected = w && (w.integrations.windsor || w.integrations.metricool);
  const hasData = w && w.followers.atual != null;
  const next = w ? new Date(w.nextRefreshAt) : null;

  return (
    <section className={`ig-widget ${compact ? "ig-compact" : ""}`} aria-label="Instagram ao vivo">
      <div className="ig-head">
        <span className="ig-logo" aria-hidden />
        <div style={{ minWidth: 0 }}>
          <div className="ig-handle">{w?.handle ? `@${w.handle}` : "Instagram"}</div>
          <div className="tiny muted">
            {loading ? "Atualizando…" : !w ? "Carregando…"
              : w.onlyManual ? `Números lançados à mão ${ago(w.lastDataAt, now)}`
              : `Atualizado ${ago(w.lastSyncAt ?? w.lastDataAt, now)}${connected && next ? ` · próxima às ${next.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}`}
          </div>
        </div>
        <div className="row" style={{ gap: 4, marginLeft: "auto" }}>
          <button className="btn btn-ghost btn-xs" disabled={loading} onClick={() => load(true)} title="Atualizar agora">↻</button>
          {compact ? <Link className="btn btn-ghost btn-xs" href="/widget">Abrir</Link> : <Link className="btn btn-ghost btn-xs" href="/jornal">Jornal</Link>}
        </div>
      </div>

      {error && <div className="tiny" style={{ color: "var(--bad)" }}>{error}</div>}
      {w && !connected && !hasData && (
        <div className="small muted">Conecte o Windsor.ai ou o Metricool em <Link href="/configuracoes">Configurações</Link> para ver os números do Instagram aqui. Você também pode lançar números à mão no <Link href="/jornal">Jornal</Link>.</div>
      )}
      {w && (connected || hasData) && (
        <div className="ig-body">
          <div className="ig-kpi ig-main">
            <div className="tiny muted">Seguidores</div>
            <div className="ig-n">{nf(w.followers.atual)}</div>
            <div className="stack" style={{ gap: 2 }}>
              <Delta k={w.followers} suffix="em 24h" />
              <Delta k={w.followers7} suffix="em 7 dias" />
            </div>
          </div>
          <Spark data={w.spark} />
          <div className="ig-kpi"><div className="tiny muted">Alcance · 7 dias</div><div className="ig-n2">{nf(w.reach7.atual)}</div><Delta k={w.reach7} /></div>
          <div className="ig-kpi"><div className="tiny muted">Visualizações · 7 dias</div><div className="ig-n2">{nf(w.views7.atual)}</div><Delta k={w.views7} /></div>
          {!compact && <div className="ig-kpi"><div className="tiny muted">Visitas ao perfil · 7 dias</div><div className="ig-n2">{nf(w.profileViews7.atual)}</div><Delta k={w.profileViews7} /></div>}
          <div className="ig-kpi">
            <div className="tiny muted">Ranking</div>
            <div className="ig-n2">{w.ranking.position ? `${w.ranking.position}º` : "—"}<span className="tiny muted" style={{ fontFamily: "var(--font-sans)" }}> de {w.ranking.total}</span></div>
            <div className="tiny muted">por seguidores</div>
          </div>
          <div className="ig-kpi">
            <div className="tiny muted">Próximo post</div>
            {w.nextPost
              ? <div className="small" style={{ fontWeight: 600 }}>{new Date(w.nextPost.at).toLocaleString("pt-BR", { timeZone: w.nextPost.timezone, weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {TYPE[w.nextPost.type] ?? w.nextPost.type}</div>
              : <div className="small muted">Nada agendado</div>}
            <div className="tiny muted">{w.upcoming7} em 7 dias{w.pendingConfirmation ? ` · ${w.pendingConfirmation} aguardando confirmação` : ""}</div>
          </div>
        </div>
      )}
      {w?.lastError && <div className="tiny muted" style={{ marginTop: 6 }}>Última falha de sincronização: {w.lastError.slice(0, 160)}</div>}
    </section>
  );
}
