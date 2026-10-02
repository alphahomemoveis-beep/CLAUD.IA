"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { Modal, Toast } from "@/components/Modal";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Kpi { atual: number | null; anterior: number | null; variacao: number | null; variacao_pct: number | null; direcao: "sobe" | "cai" | "estavel" | "sem_dados" }
interface Journal {
  days: number; end: string; own: { handle: string } | null;
  kpis: { periodo: { start: string; end: string; prevStart: string; prevEnd: string }; seguidores: Kpi; reach: Kpi; impressions: Kpi; views: Kpi; profile_views: Kpi; interactions: Kpi; serie: Array<{ day: string; followers: number }> };
  ranking: Array<{ id: string; handle: string; name: string; is_own: boolean; seguidores: number | null; crescimento: Kpi; posicao: number }>;
  profiles: Array<{ id: string; handle: string; display_name: string; is_own: boolean }>;
  posts: Record<string, number>; upcoming: number;
  sources: Record<"windsor" | "metricool", { configured: boolean; last: { ok: boolean; message: string; created_at: string } | null }>;
  aiEnabled?: boolean;
  edition: { editorial: { manchete: string; linha_fina: string; materias: Array<{ titulo: string; texto: string }>; recomendacoes: string[] }; created_at: string } | null;
}

const nf = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("pt-BR"));
const pct = (v: number | null) => (v == null ? "" : `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const dmy = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

/** Seta com sinal e texto: a cor nunca é a única pista. */
function Delta({ k, unit = "" }: { k: Kpi; unit?: string }) {
  if (k.direcao === "sem_dados") return <span className="delta delta-none">sem comparação</span>;
  const cls = k.direcao === "sobe" ? "delta-up" : k.direcao === "cai" ? "delta-down" : "delta-flat";
  const icon = k.direcao === "sobe" ? "▲" : k.direcao === "cai" ? "▼" : "▬";
  const label = k.direcao === "sobe" ? "subiu" : k.direcao === "cai" ? "caiu" : "estável";
  return (
    <span className={`delta ${cls}`} title={`Período anterior: ${nf(k.anterior)}`}>
      <span aria-hidden>{icon}</span> {pct(k.variacao_pct) || "0,0%"}
      <span className="sr-only"> {label}</span>
      {k.variacao != null && k.variacao !== 0 && <span className="delta-abs"> ({k.variacao > 0 ? "+" : ""}{nf(k.variacao)}{unit})</span>}
    </span>
  );
}

function KpiTile({ label, k, hint }: { label: string; k: Kpi; hint: string }) {
  return (
    <div className="stat">
      <div className="l" style={{ marginTop: 0, marginBottom: 8 }}>{label}</div>
      <div className="n">{nf(k.atual)}</div>
      <div style={{ marginTop: 8 }}><Delta k={k} /></div>
      <div className="tiny muted" style={{ marginTop: 6 }}>{hint}</div>
    </div>
  );
}

/** Linha de seguidores: uma série, 2px, grade discreta, cursor com dica. */
function FollowersChart({ data }: { data: Array<{ day: string; followers: number }> }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <div className="empty">O gráfico aparece com pelo menos dois dias de seguidores sincronizados.</div>;
  const W = 640, H = 240, L = 62, R = 14, T = 16, B = 30;
  const vals = data.map((d) => d.followers);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;
  const x = (i: number) => L + (i / (data.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ticks = [0, 0.5, 1].map((t) => min + t * (max - min));
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.followers).toFixed(1)}`).join(" ");
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - L) / (W - L - R)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const h = hover != null ? data[hover] : null;
  return (
    <div style={{ position: "relative" }}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Seguidores de ${dmy(data[0].day)} a ${dmy(data[data.length - 1].day)}: de ${nf(vals[0])} para ${nf(vals[vals.length - 1])}`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block", touchAction: "none" }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="14" fill="var(--muted)">{nf(t)}</text>
          </g>
        ))}
        <text x={L} y={H - 8} fontSize="14" fill="var(--muted)">{dmy(data[0].day)}</text>
        <text x={W - R} y={H - 8} fontSize="14" fill="var(--muted)" textAnchor="end">{dmy(data[data.length - 1].day)}</text>
        <path d={path} fill="none" stroke="var(--chart)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(data.length - 1)} cy={y(vals[vals.length - 1])} r="4" fill="var(--chart)" stroke="var(--surface)" strokeWidth="2" />
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--line-2)" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(h.followers)} r="5" fill="var(--chart)" stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && hover != null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="tiny muted">{new Date(`${h.day}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}</div>
          <strong>{nf(h.followers)}</strong> seguidores
        </div>
      )}
    </div>
  );
}

export default function JournalPage() {
  const [days, setDays] = useState(30);
  const [j, setJ] = useState<Journal | null>(null);
  const [busy, setBusy] = useState<"sync" | "edit" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState<{ id: string; handle: string } | null>(null);
  const [showTable, setShowTable] = useState(false);

  const load = useCallback(() => api<Journal>(`/api/journal?dias=${days}`).then(setJ).catch((e) => setToast(e.message)), [days]);
  useEffect(() => { load(); }, [load]);

  async function sync() {
    setBusy("sync");
    try {
      const r = await api<any>("/api/journal/sync", { method: "POST" });
      setToast(`Windsor: ${r.windsor.message} · Metricool: ${r.metricool.message}`);
      await load();
    } catch (err) { setToast((err as Error).message); } finally { setBusy(null); }
  }
  async function writeEdition() {
    setBusy("edit");
    try {
      await api(`/api/journal/editorial?dias=${days}`, { method: "POST" });
      await load();
    } catch (err) { setToast((err as Error).message); } finally { setBusy(null); }
  }
  async function removeProfile(id: string, handle: string) {
    if (!window.confirm(`Tirar @${handle} do ranking?`)) return;
    await api(`/api/journal/profiles/${id}?confirmar=sim`, { method: "DELETE" });
    load();
  }

  if (!j) return <div className="page"><span className="spinner" /></div>;
  const e = j.edition?.editorial;
  const noData = j.kpis.seguidores.atual == null && j.ranking.length === 0;
  const published = j.posts.publicado ?? 0;

  return (
    <div className="page journal">
      <header className="masthead">
        <div className="eyebrow">Edição de {new Date(`${j.end}T12:00:00`).toLocaleDateString("pt-BR", { dateStyle: "full" })}</div>
        <div className="paper-name">O Jornal AlphaHome</div>
        <div className="spread" style={{ borderTop: "1px solid var(--ink)", borderBottom: "1px solid var(--ink)", padding: "8px 0", marginTop: 10 }}>
          <div className="row small">
            {[7, 30, 90].map((d) => <button key={d} className={`chip ${days === d ? "on" : ""}`} onClick={() => setDays(d)}>Últimos {d} dias</button>)}
          </div>
          <div className="tiny muted">{dmy(j.kpis.periodo.start)} a {dmy(j.kpis.periodo.end)} · comparado com {dmy(j.kpis.periodo.prevStart)} a {dmy(j.kpis.periodo.prevEnd)}</div>
        </div>
      </header>

      {noData && (
        <div className="alert alert-info" style={{ margin: "18px 0" }}>
          Ainda não há números. Conecte o Windsor.ai e o Metricool em ⚙️ Configurações e clique em “Sincronizar agora”, ou lance os números à mão no ranking abaixo.
        </div>
      )}

      <section className="lead-story">
        {e ? (
          <>
            <h1 className="headline">{e.manchete}</h1>
            <p className="standfirst">{e.linha_fina}</p>
            <div className="tiny muted">Editorial escrito pela IA em {fmtDate(j.edition!.created_at)} com os números desta página.</div>
          </>
        ) : (
          <>
            <h1 className="headline">{j.kpis.seguidores.atual != null ? `${nf(j.kpis.seguidores.atual)} seguidores${j.kpis.seguidores.variacao_pct != null ? `, ${pct(j.kpis.seguidores.variacao_pct)} no período` : ""}` : "Sua primeira edição está a uma sincronização de distância"}</h1>
            <p className="standfirst">{j.aiEnabled === false ? "Os números abaixo são calculados direto das fontes. O editorial com IA está desligado." : "Gere o editorial para a IA transformar os números em manchetes e recomendações."}</p>
          </>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          {j.aiEnabled !== false && <button className="btn btn-primary" disabled={!!busy} onClick={writeEdition}>{busy === "edit" ? <span className="spinner" /> : e ? "Reescrever editorial" : "Gerar editorial"}</button>}
          <button className="btn" disabled={!!busy} onClick={sync}>{busy === "sync" ? <span className="spinner" /> : "Sincronizar agora"}</button>
        </div>
      </section>

      <div className="grid-3 kpi-grid">
        <KpiTile label="Seguidores" k={j.kpis.seguidores} hint="Total no fim do período" />
        <KpiTile label="Alcance" k={j.kpis.reach} hint="Contas alcançadas, soma do período" />
        <KpiTile label="Visualizações" k={j.kpis.views.atual != null ? j.kpis.views : j.kpis.impressions} hint={j.kpis.views.atual != null ? "Visualizações, soma do período" : "Impressões, soma do período"} />
        <KpiTile label="Visitas ao perfil" k={j.kpis.profile_views} hint="Soma do período" />
        <KpiTile label="Interações" k={j.kpis.interactions} hint="Curtidas, comentários, salvos e compartilhamentos" />
        <div className="stat">
          <div className="l" style={{ marginTop: 0, marginBottom: 8 }}>Posts</div>
          <div className="n">{published}</div>
          <div className="tiny muted" style={{ marginTop: 8 }}>publicados pela agenda no período · {j.upcoming} agendados para os próximos 7 dias</div>
        </div>
      </div>

      <div className="journal-cols">
        <section className="card">
          <div className="spread" style={{ marginBottom: 10 }}>
            <h2>Seguidores{j.own ? ` de @${j.own.handle}` : ""}</h2>
            <button className="btn btn-ghost btn-xs" onClick={() => setShowTable(!showTable)}>{showTable ? "Ver gráfico" : "Ver tabela"}</button>
          </div>
          {showTable
            ? <table className="script-table"><thead><tr><th>Dia</th><th style={{ textAlign: "right" }}>Seguidores</th></tr></thead>
                <tbody>{j.kpis.serie.map((r) => <tr key={r.day}><td>{dmy(r.day)}</td><td style={{ textAlign: "right" }}>{nf(r.followers)}</td></tr>)}</tbody></table>
            : <FollowersChart data={j.kpis.serie} />}
        </section>

        <section className="card">
          <div className="spread" style={{ marginBottom: 10 }}>
            <h2>Ranking de seguidores</h2>
            <button className="btn btn-sm" onClick={() => setAdding(true)}>＋ Perfil</button>
          </div>
          {j.ranking.length === 0 && <div className="small muted">Adicione a sua conta e os perfis que quer comparar. Os concorrentes cadastrados no Metricool entram sozinhos.</div>}
          <ol className="ranking">
            {j.ranking.map((r) => (
              <li key={r.id} className={r.is_own ? "own" : ""}>
                <span className="pos">{r.posicao <= 3 ? ["🥇", "🥈", "🥉"][r.posicao - 1] : `${r.posicao}º`}</span>
                <span className="who">
                  <strong>@{r.handle}</strong>{r.is_own && <span className="chip chip-wood" style={{ marginLeft: 6 }}>você</span>}
                  {r.name && <span className="tiny muted"> {r.name}</span>}
                </span>
                <span className="num">{nf(r.seguidores)}</span>
                <span className="grow"><Delta k={r.crescimento} /></span>
              </li>
            ))}
          </ol>
          {j.profiles.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="small" style={{ cursor: "pointer" }}>Perfis acompanhados e lançamento manual</summary>
              <div className="list" style={{ marginTop: 8 }}>
                {j.profiles.map((p) => (
                  <div key={p.id} className="list-item small">
                    <span>@{p.handle} {p.is_own && <span className="chip chip-wood">você</span>}</span>
                    <span className="row">
                      <button className="btn btn-ghost btn-xs" onClick={() => setManual({ id: p.id, handle: p.handle })}>Lançar números</button>
                      {!p.is_own && <button className="btn btn-ghost btn-xs btn-danger" onClick={() => removeProfile(p.id, p.handle)}>Remover</button>}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>

      {e && (
        <section className="articles">
          {e.materias.map((m, i) => (
            <article key={i}>
              <h3>{m.titulo}</h3>
              {m.texto.split(/\n+/).map((p, k) => <p key={k}>{p}</p>)}
            </article>
          ))}
          <article className="reco">
            <h3>Recomendações da semana</h3>
            <ul>{e.recomendacoes.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </article>
        </section>
      )}

      <section className="card-flat" style={{ marginTop: 26 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Fontes dos dados</div>
        <div className="grid-2 small">
          {(["windsor", "metricool"] as const).map((s) => {
            const src = j.sources[s];
            return (
              <div key={s}>
                <strong>{s === "windsor" ? "Windsor.ai · Instagram da marca" : "Metricool · concorrentes e séries"}</strong>
                <div className="muted">
                  {!src.configured ? "Não conectado." : src.last ? `${src.last.ok ? "✓" : "✗"} ${fmtDate(src.last.created_at)} · ${src.last.message}` : "Conectado, ainda sem sincronização."}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {adding && <AddProfile hasOwn={j.profiles.some((p) => p.is_own)} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {manual && <ManualNumbers profile={manual} onClose={() => setManual(null)} onSaved={() => { setManual(null); load(); }} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function AddProfile({ hasOwn, onClose, onSaved }: { hasOwn: boolean; onClose: () => void; onSaved: () => void }) {
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [own, setOwn] = useState(!hasOwn);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Adicionar perfil ao ranking" onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try { await api("/api/journal/profiles", { method: "POST", json: { handle, display_name: name, is_own: own } }); onSaved(); }
        catch (err) { setError((err as Error).message); }
      }}>
        {error && <div className="alert">{error}</div>}
        <label className="field"><span className="label">@ do Instagram</span><input className="input" required value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="alphahome.moveis" /></label>
        <label className="field"><span className="label">Nome (opcional)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {!hasOwn && <label className="check"><input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} /> Este é o perfil da AlphaHome</label>}
        <button className="btn btn-primary">Adicionar</button>
      </form>
    </Modal>
  );
}

function ManualNumbers({ profile, onClose, onSaved }: { profile: { id: string; handle: string }; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<Record<string, string>>({ day: today, followers: "", reach: "", views: "", profile_views: "", interactions: "" });
  const [error, setError] = useState<string | null>(null);
  const toN = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\D/g, "")));
  return (
    <Modal title={`Lançar números de @${profile.handle}`} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api(`/api/journal/profiles/${profile.id}/metrics`, { method: "POST", json: {
            day: f.day, followers: toN(f.followers), reach: toN(f.reach), views: toN(f.views), profile_views: toN(f.profile_views), interactions: toN(f.interactions),
          } });
          onSaved();
        } catch (err) { setError((err as Error).message); }
      }}>
        {error && <div className="alert">{error}</div>}
        <div className="grid-2">
          <label className="field"><span className="label">Dia</span><input className="input" type="date" required value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></label>
          {[["followers", "Seguidores"], ["reach", "Alcance do dia"], ["views", "Visualizações do dia"], ["profile_views", "Visitas ao perfil"], ["interactions", "Interações"]].map(([k, l]) => (
            <label key={k} className="field"><span className="label">{l}</span><input className="input" inputMode="numeric" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
          ))}
        </div>
        <div className="hint">Números manuais só valem onde a integração não trouxer dado para o mesmo dia.</div>
        <button className="btn btn-primary">Salvar</button>
      </form>
    </Modal>
  );
}
