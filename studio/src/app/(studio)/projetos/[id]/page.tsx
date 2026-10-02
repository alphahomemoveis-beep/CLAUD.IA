"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { api, fmtDate, pad } from "@/lib/client";
import { PROJECT_STATUS, QUALITY_LABEL, REF_STATUS, STAGE_LABEL, TYPE_LABEL } from "@/lib/labels";
import { ImageTile } from "@/components/chat/ImageTile";
import type { ChatImage } from "@/components/chat/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Detail {
  project: any;
  concepts: any[];
  plans: any[];
  images: ChatImage[];
  feedback: any[];
  references: any[];
  preferences: any[];
}

const TABS = ["Resumo", "Conceitos", "Planejamentos", "Imagens e prompts", "Feedback", "Referências"] as const;

export default function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Resumo");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => api<Detail>(`/api/projects/${id}`).then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(status: string) {
    await api(`/api/projects/${id}`, { method: "PATCH", json: { status } });
    load();
  }

  if (error) return <div className="page"><div className="alert">{error}</div></div>;
  if (!d) return <div className="page"><span className="spinner" /></div>;
  const p = d.project;
  const versions = [...new Set(d.images.map((i) => i.version))].sort((a, b) => b - a);
  const tall = p.content_type === "reels" || p.content_type === "story";
  const rounds = [...new Set(d.concepts.map((c) => c.round))];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/projetos">📁 Projetos</Link> / {TYPE_LABEL[p.content_type]}</div>
          <h1>Projeto: {p.title}</h1>
          <div className="row" style={{ marginTop: 10 }}>
            <span className={`chip ${PROJECT_STATUS[p.status]?.tone}`}>Status: {PROJECT_STATUS[p.status]?.icon} {PROJECT_STATUS[p.status]?.label}</span>
            <span className="chip chip-wood">Etapa: {STAGE_LABEL[p.stage]}</span>
            <span className="chip">Versão: v{pad(p.current_version)}</span>
            <span className="tiny muted">Criado em {fmtDate(p.created_at)}</span>
          </div>
        </div>
        <div className="row">
          {p.conversation_id && <Link className="btn btn-primary" href={`/chat/${p.conversation_id}`}>Continuar na conversa</Link>}
          <select className="select" style={{ width: "auto" }} value={p.status} onChange={(e) => setStatus(e.target.value)} aria-label="Status do projeto">
            {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
      </div>
      {notice && <div className="alert alert-info" style={{ marginBottom: 16 }}>{notice}</div>}

      <div className="tabs">{TABS.map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>

      {tab === "Resumo" && (
        <div className="grid-2">
          <div className="card">
            <h3>Briefing</h3>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Tipo</dt><dd>{TYPE_LABEL[p.briefing.tipo]}</dd>
              <dt>Tema</dt><dd>{p.briefing.tema}</dd>
              <dt>Público</dt><dd>{p.briefing.publico}</dd>
              <dt>Objetivo</dt><dd>{p.briefing.objetivo}</dd>
              <dt>Ambiente</dt><dd>{p.briefing.ambiente}</dd>
              <dt>Estética</dt><dd>{p.briefing.estetica}</dd>
            </dl>
          </div>
          <div className="card">
            <h3>Pesquisa de mercado</h3>
            {!p.research && <p className="muted">Sem pesquisa.</p>}
            {p.research && (
              <>
                <p className="small">{p.research.resumo}</p>
                <div className="tiny muted">{p.research.disponivel ? `Pesquisado em ${fmtDate(p.research.pesquisado_em)}` : "Sem pesquisa atual"}</div>
                {p.research.tendencias_atuais?.map((t: any, i: number) => (
                  <div key={i} className="small" style={{ marginTop: 8 }}><span className="chip chip-ok">ATUAL</span> {t.titulo} {t.fonte_url && <a href={t.fonte_url} target="_blank" rel="noreferrer noopener">fonte</a>}</div>
                ))}
                {p.research.referencias_historicas?.map((t: any, i: number) => (
                  <div key={i} className="small" style={{ marginTop: 8 }}><span className="chip">HISTÓRICA</span> {t.titulo}</div>
                ))}
              </>
            )}
          </div>
          <div className="card">
            <h3>Conceito escolhido</h3>
            {(() => {
              const c = d.concepts.find((x) => x.id === p.chosen_concept_id);
              return c ? <><div className="quote" style={{ fontFamily: "var(--font-display)", fontSize: 24, marginTop: 8 }}>“{c.title}”</div><div className="small muted">Conceito {pad(c.number)} · rodada {c.round} · {c.environment}</div></> : <p className="muted">Nenhum conceito escolhido ainda.</p>;
            })()}
          </div>
          <div className="card">
            <h3>Preferências deste projeto</h3>
            {d.preferences.length === 0 && <p className="muted small">Nenhuma ainda.</p>}
            {d.preferences.map((x) => <div key={x.id} className="small" style={{ marginTop: 6 }}><span className="chip">{x.kind}</span> {x.rule} <span className="tiny muted">({x.scope})</span></div>)}
          </div>
        </div>
      )}

      {tab === "Conceitos" && (
        <div className="stack">
          {rounds.length === 0 && <div className="empty">Nenhum conceito.</div>}
          {rounds.map((r) => (
            <div key={r}>
              <div className="eyebrow" style={{ margin: "8px 0" }}>Rodada {r}</div>
              <div className="concepts">
                {d.concepts.filter((c) => c.round === r).map((c) => (
                  <div key={c.id} className={`concept ${c.chosen ? "chosen" : ""}`}>
                    <div className="spread"><span className="num">CONCEITO {pad(c.number)}</span>{c.chosen && <span className="chip chip-wood">Escolhido</span>}</div>
                    <div className="quote">“{c.title}”</div>
                    <dl><dt>Ambiente</dt><dd>{c.data.ambiente}</dd><dt>Paleta</dt><dd>{c.data.paleta}</dd><dt>Protagonista</dt><dd>{c.data.protagonista}</dd><dt>Objetivo</dt><dd>{c.data.objetivo}</dd></dl>
                    <div className="small muted">{c.data.ideia}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "Planejamentos" && (
        <div className="stack">
          {d.plans.length === 0 && <div className="empty">Nenhum planejamento.</div>}
          {[...d.plans].reverse().map((pl) => (
            <details key={pl.id} className="card" open={pl.version === d.plans[d.plans.length - 1]?.version}>
              <summary className="spread" style={{ cursor: "pointer" }}>
                <strong>Planejamento v{pad(pl.version)} — {pl.data.conceito}</strong>
                <span className={`chip ${pl.approved ? "chip-ok" : ""}`}>{pl.approved ? `🟢 Aprovado ${fmtDate(pl.approved_at)}` : "Não aprovado"}</span>
              </summary>
              <div className="plan-grid" style={{ marginTop: 14 }}>
                {[["Ambiente", pl.data.ambiente], ["Cenário", pl.data.cenario], ["Paleta", pl.data.paleta.join(" · ")], ["Materiais", pl.data.materiais.join(" · ")],
                  ["Protagonista", pl.data.produto_protagonista], ["Composição", pl.data.composicao], ["Enquadramento", pl.data.enquadramento],
                  ["Iluminação", pl.data.iluminacao], ["Texto", pl.data.texto], ["Logo", pl.data.logo], ["Assinatura", pl.data.assinatura], ["Formato", pl.data.formato]]
                  .map(([k, v]) => <div key={k} className="plan-field"><div className="k">{k}</div><div className="v">{v}</div></div>)}
              </div>
              <div className="slides" style={{ marginTop: 14 }}>
                {pl.data.pecas.map((s: any) => <div key={s.numero} className="slide"><div className="role">{pad(s.numero)} — {s.papel}</div><div>{s.titulo}</div><div className="tiny muted">{s.texto_na_arte}</div></div>)}
              </div>
              {pl.data.roteiro && (
                <table className="script-table" style={{ marginTop: 14 }}>
                  <thead><tr><th>Etapa</th><th>Texto falado</th><th>Texto na tela</th><th>Cena</th><th>B-roll</th><th>Duração</th></tr></thead>
                  <tbody>{pl.data.roteiro.blocos.map((b: any, i: number) => <tr key={i}><td>{b.etapa}</td><td>{b.texto_falado}</td><td>{b.texto_na_tela}</td><td>{b.cena}</td><td>{b.broll}</td><td>{b.duracao_segundos}s</td></tr>)}</tbody>
                </table>
              )}
            </details>
          ))}
        </div>
      )}

      {tab === "Imagens e prompts" && (
        <div className="stack">
          {versions.length === 0 && <div className="empty">Nenhuma imagem gerada.</div>}
          {versions.map((v) => (
            <div key={v}>
              <div className="section-title" style={{ marginTop: 10 }}><h3>Versão v{pad(v)}</h3></div>
              <div className="images">
                {d.images.filter((i) => i.version === v).map((img) => (
                  <div key={img.id} className="stack" style={{ gap: 6 }}>
                    <ImageTile image={img} tall={tall} canGenerate={false} onGenerate={() => undefined} onNotice={setNotice}
                      onUpdated={() => load()} readOnly={false} />
                    {img.quality_review?.checklist?.length ? (
                      <div className="tiny muted">
                        Checklist: {img.quality_review.checklist.filter((c) => c.aprovado).length}/{img.quality_review.checklist.length}
                        {img.quality_review.checklist.filter((c) => !c.aprovado).map((c) => ` · ✗ ${QUALITY_LABEL[c.item]}`)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "Feedback" && (
        <div className="list">
          {d.feedback.length === 0 && <div className="empty">Nenhum feedback ainda.</div>}
          {d.feedback.map((f) => (
            <div key={f.id} className="list-item">
              <div>
                <span className="chip">{{ aprovar: "👍 Aprovou", rejeitar: "👎 Rejeitou", favoritar: "⭐ Favoritou", alterar: "✏️ Pediu alteração" }[f.kind as string]}</span>
                <span style={{ marginLeft: 10 }}>{f.comment || <span className="muted">sem comentário</span>}</span>
              </div>
              <span className="tiny muted">{f.user_name} · {fmtDate(f.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "Referências" && (
        <div className="lib-grid">
          {d.references.length === 0 && <div className="empty">Nenhuma referência usada.</div>}
          {d.references.map((r) => (
            <Link key={r.id} href={`/biblioteca?ref=${r.id}`} className="ref-card" style={{ textDecoration: "none" }}>
              <div className="thumb">{r.media_type === "video" ? <video src={`/api/references/${r.id}/file`} muted /> : <img src={`/api/references/${r.id}/file`} alt={r.name} />}</div>
              <div className="body"><div className="name">{r.name}</div><span className={`chip ${REF_STATUS[r.status]?.tone}`}>{REF_STATUS[r.status]?.icon} {REF_STATUS[r.status]?.label}</span></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
