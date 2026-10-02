"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { CATEGORIES, PROJECT_STATUS, REF_STATUS, TYPE_LABEL } from "@/lib/labels";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Data {
  totals: { projetos: number; conversas: number; imagens: number; preferencias: number };
  byType: Array<{ content_type: string; n: number }>;
  byStatus: Array<{ status: string; n: number }>;
  verdicts: Array<{ verdict: string; n: number }>;
  topReferences: Array<{ id: string; name: string; category: string; usos: number }>;
  recentFeedback: Array<{ kind: string; comment: string; created_at: string; title: string }>;
  research: Array<{ id: string; title: string; pesquisado_em: string; tendencias: any[]; disponivel: boolean }>;
  library: Array<{ status: string; n: number }>;
}

const VERDICT: Record<string, string> = { aprovada: "👍 Aprovadas", rejeitada: "👎 Rejeitadas", alteracao: "✏️ Com alteração", sem_avaliacao: "Sem avaliação" };

/** Barras horizontais de uma série: valor escrito ao lado e detalhe ao passar o mouse. */
function Bars({ rows, unit }: { rows: Array<{ label: string; n: number }>; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (!rows.length) return <div className="small muted">Sem dados ainda.</div>;
  return (
    <div className="bars" role="table">
      {rows.map((r) => (
        <div key={r.label} className="bar" role="row" title={`${r.label}: ${r.n} ${unit} (${Math.round((r.n / Math.max(1, total)) * 100)}%)`}>
          <span role="cell">{r.label}</span>
          <div className="track" aria-hidden><div className="fill" style={{ width: `${(r.n / max) * 100}%` }} /></div>
          <span className="val" role="cell">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

export default function InsightsPage() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Data>("/api/insights").then(setD).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="page"><div className="alert">{error}</div></div>;
  if (!d) return <div className="page"><span className="spinner" /></div>;
  const rated = d.verdicts.filter((v) => v.verdict !== "sem_avaliacao").reduce((s, v) => s + v.n, 0);
  const approved = d.verdicts.find((v) => v.verdict === "aprovada")?.n ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">📊 Insights</div>
          <h1>Como o estúdio está criando</h1>
          <p className="lead">Produção, aprovação, referências mais usadas e o que o feedback está ensinando.</p>
        </div>
      </div>

      <div className="grid-4">
        <div className="stat"><div className="n">{d.totals.projetos}</div><div className="l">Projetos</div></div>
        <div className="stat"><div className="n">{d.totals.imagens}</div><div className="l">Imagens geradas</div></div>
        <div className="stat"><div className="n">{rated ? `${Math.round((approved / rated) * 100)}%` : "—"}</div><div className="l">Taxa de aprovação</div><div className="tiny muted" style={{ marginTop: 6 }}>{approved} de {rated} avaliadas</div></div>
        <div className="stat"><div className="n">{d.totals.preferencias}</div><div className="l">Preferências ativas</div></div>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="card"><h3 style={{ marginBottom: 14 }}>Projetos por formato</h3><Bars unit="projetos" rows={d.byType.map((r) => ({ label: TYPE_LABEL[r.content_type] ?? r.content_type, n: r.n }))} /></div>
        <div className="card"><h3 style={{ marginBottom: 14 }}>Projetos por status</h3><Bars unit="projetos" rows={d.byStatus.map((r) => ({ label: `${PROJECT_STATUS[r.status]?.icon ?? ""} ${PROJECT_STATUS[r.status]?.label ?? r.status}`, n: r.n }))} /></div>
        <div className="card"><h3 style={{ marginBottom: 14 }}>Avaliação das imagens</h3><Bars unit="imagens" rows={d.verdicts.map((r) => ({ label: VERDICT[r.verdict] ?? r.verdict, n: r.n }))} /></div>
        <div className="card"><h3 style={{ marginBottom: 14 }}>Biblioteca visual</h3><Bars unit="referências" rows={d.library.map((r) => ({ label: `${REF_STATUS[r.status]?.icon} ${REF_STATUS[r.status]?.label}`, n: r.n }))} /></div>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Referências mais usadas</h3>
          {d.topReferences.length === 0 && <div className="small muted">Nenhuma referência usada em planejamentos ainda.</div>}
          {d.topReferences.map((r) => (
            <div key={r.id} className="spread small" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <Link href={`/biblioteca?ref=${r.id}`}>{CATEGORIES.find((c) => c.id === r.category)?.icon} {r.name}</Link>
              <span className="muted">{r.usos} {r.usos === 1 ? "uso" : "usos"}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>Feedback recente</h3>
          {d.recentFeedback.length === 0 && <div className="small muted">Nenhum comentário ainda.</div>}
          {d.recentFeedback.map((f, i) => (
            <div key={i} className="small" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              “{f.comment}” <span className="tiny muted">· {f.title} · {fmtDate(f.created_at)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title"><h2>Pesquisas de mercado</h2><span className="tiny muted">tendência atual só com fonte recente</span></div>
      {d.research.length === 0 && <div className="empty">Nenhuma pesquisa ainda.</div>}
      <div className="grid-3">
        {d.research.map((r) => (
          <Link key={r.id} href={`/projetos/${r.id}`} className="card" style={{ textDecoration: "none" }}>
            <div className="spread"><strong>{r.title}</strong>{r.disponivel ? <span className="chip chip-ok">web</span> : <span className="chip">sem pesquisa</span>}</div>
            <div className="tiny muted">{fmtDate(r.pesquisado_em)}</div>
            <div className="stack" style={{ gap: 4, marginTop: 8 }}>
              {(r.tendencias ?? []).slice(0, 4).map((t: any, i: number) => <div key={i} className="small">• {t.titulo}</div>)}
              {(!r.tendencias || r.tendencias.length === 0) && <div className="small muted">Nenhuma tendência atual confirmada.</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
