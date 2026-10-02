"use client";

import { useState } from "react";
import { pad } from "@/lib/client";
import { QUALITY_LABEL, REF_STATUS, TYPE_LABEL } from "@/lib/labels";
import type { ChatMessage } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function BriefingCard({ msg }: { msg: ChatMessage }) {
  const b = msg.payload?.briefing ?? {};
  return (
    <div className="card">
      <div className="eyebrow">A IA analisou o pedido</div>
      <dl className="kv" style={{ marginTop: 14 }}>
        <dt>Tipo</dt><dd>{TYPE_LABEL[b.tipo] ?? b.tipo}</dd>
        <dt>Tema</dt><dd>{b.tema}</dd>
        <dt>Público</dt><dd>{b.publico}</dd>
        <dt>Objetivo</dt><dd>{b.objetivo}</dd>
        <dt>Ambiente</dt><dd>{b.ambiente}{b.multiplos_ambientes_solicitados ? " · vários ambientes pedidos" : ""}</dd>
        <dt>Estética</dt><dd>{b.estetica}</dd>
      </dl>
    </div>
  );
}

export function ResearchCard({ msg }: { msg: ChatMessage }) {
  const r = msg.payload?.research;
  const [open, setOpen] = useState(false);
  if (!r) return null;
  return (
    <div className="card">
      <div className="spread">
        <div className="eyebrow">Pesquisa de mercado</div>
        {r.disponivel
          ? <span className="chip chip-ok">Pesquisa na web · {new Date(r.pesquisado_em).toLocaleDateString("pt-BR")}</span>
          : <span className="chip">Sem pesquisa atual</span>}
      </div>
      <p style={{ margin: "10px 0 0" }}>{r.resumo}</p>
      {(r.tendencias_atuais?.length > 0 || r.referencias_historicas?.length > 0) && (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => setOpen(!open)}>
          {open ? "Esconder detalhes" : `Ver ${r.tendencias_atuais.length} tendências atuais e ${r.referencias_historicas.length} referências históricas`}
        </button>
      )}
      {open && (
        <div className="grid-2" style={{ marginTop: 12 }}>
          <div className="card-flat">
            <div className="row" style={{ marginBottom: 8 }}><span className="chip chip-ok">TENDÊNCIA ATUAL</span><span className="tiny muted">com fonte recente</span></div>
            {r.tendencias_atuais.length === 0 && <div className="small muted">Nenhuma tendência atual confirmada por fonte.</div>}
            {r.tendencias_atuais.map((t: any, i: number) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.titulo}</div>
                <div className="small">{t.descricao}</div>
                <div className="tiny muted">
                  {t.data_referencia && <>{t.data_referencia} · </>}
                  {t.fonte_url && <a href={t.fonte_url} target="_blank" rel="noreferrer noopener">fonte</a>}
                </div>
              </div>
            ))}
          </div>
          <div className="card-flat">
            <div className="row" style={{ marginBottom: 8 }}><span className="chip">REFERÊNCIA HISTÓRICA</span><span className="tiny muted">linguagem consolidada</span></div>
            {r.referencias_historicas.map((t: any, i: number) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.titulo}</div>
                <div className="small">{t.descricao}</div>
                <div className="tiny muted">{t.por_que_ainda_importa}</div>
              </div>
            ))}
          </div>
          {r.fontes?.length > 0 && (
            <div className="tiny muted" style={{ gridColumn: "1 / -1" }}>
              Fontes: {r.fontes.map((f: any, i: number) => <span key={f.url}>{i > 0 && " · "}<a href={f.url} target="_blank" rel="noreferrer noopener">{f.title}</a></span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ReferencesCard({ msg }: { msg: ChatMessage }) {
  const refs: any[] = msg.payload?.references ?? [];
  return (
    <div className="card-flat">
      <div className="spread" style={{ marginBottom: refs.length ? 10 : 0 }}>
        <div className="eyebrow">Referências AlphaHome consultadas</div>
        <span className="tiny muted">{msg.content}</span>
      </div>
      {refs.length > 0 && (
        <div className="refs-strip">
          {refs.map((r) => (
            <a key={r.id} className="ref-mini" href={`/biblioteca?ref=${r.id}`} style={{ textDecoration: "none" }}>
              <div className="thumb">
                {r.media_type === "video"
                  ? <video src={`/api/references/${r.id}/file`} muted />
                  : <img src={`/api/references/${r.id}/file`} alt={r.name} loading="lazy" />}
              </div>
              <div style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.favorite ? "⭐ " : ""}{r.name}</div>
              <div className="tiny muted">{REF_STATUS[r.status]?.icon} {REF_STATUS[r.status]?.label}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface ConceptsProps {
  msg: ChatMessage;
  active: boolean;
  chosenId: string | null;
  busy: boolean;
  onChoose: (id: string) => void;
  onRegenerate: (notes: string) => void;
}

export function ConceptsCard({ msg, active, chosenId, busy, onChoose, onRegenerate }: ConceptsProps) {
  const p = msg.payload ?? {};
  const [notes, setNotes] = useState("");
  const [asking, setAsking] = useState(false);
  return (
    <div className="stack">
      <div>
        <div className="eyebrow">💡 Conceitos disponíveis{p.round > 1 ? ` · rodada ${p.round}` : ""}</div>
        {p.introducao && <p style={{ margin: "6px 0 0" }}>{p.introducao}</p>}
      </div>
      <div className="concepts">
        {(p.concepts ?? []).map((c: any) => (
          <div key={c.id} className={`concept ${chosenId === c.id ? "chosen" : ""}`}>
            <div className="spread">
              <span className="num">CONCEITO {pad(c.numero)}</span>
              {chosenId === c.id && <span className="chip chip-wood">Escolhido</span>}
            </div>
            <div className="quote">“{c.titulo}”</div>
            <dl>
              <dt>Ambiente</dt><dd>{c.ambiente}</dd>
              <dt>Paleta</dt><dd>{c.paleta}</dd>
              <dt>Protagonista</dt><dd>{c.protagonista}</dd>
              <dt>Objetivo</dt><dd>{c.objetivo}</dd>
            </dl>
            <div className="small muted">{c.ideia}</div>
            {active && (
              <button className="btn btn-sm btn-primary" style={{ marginTop: "auto" }} disabled={busy} onClick={() => onChoose(c.id)}>
                {chosenId === c.id ? "Refazer planejamento" : "Escolher este conceito"}
              </button>
            )}
          </div>
        ))}
      </div>
      {p.recomendacao && <div className="small"><strong>Recomendação:</strong> {p.recomendacao}</div>}
      {active && (
        <div className="row">
          {!asking && <button className="btn btn-sm" disabled={busy} onClick={() => setAsking(true)}>Quero outros conceitos</button>}
          {asking && (
            <>
              <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder="O que mudar nos conceitos? (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => { onRegenerate(notes); setAsking(false); setNotes(""); }}>Gerar novos conceitos</button>
            </>
          )}
          <span className="tiny muted">Nenhuma imagem é gerada antes da sua escolha.</span>
        </div>
      )}
    </div>
  );
}

interface PlanProps {
  msg: ChatMessage;
  active: boolean;
  approved: boolean;
  busy: boolean;
  onApprove: (planId: string) => void;
  onRevise: (notes: string) => void;
}

export function PlanCard({ msg, active, approved, busy, onApprove, onRevise }: PlanProps) {
  const p = msg.payload ?? {};
  const plan = p.plan ?? {};
  const [notes, setNotes] = useState("");
  const [asking, setAsking] = useState(false);
  const fields: Array<[string, any]> = [
    ["Conceito", plan.conceito], ["Objetivo", plan.objetivo], ["Ambiente", plan.ambiente], ["Cenário", plan.cenario],
    ["Paleta", plan.paleta?.join(" · ")], ["Materiais", plan.materiais?.join(" · ")], ["Produto protagonista", plan.produto_protagonista],
    ["Composição", plan.composicao], ["Enquadramento", plan.enquadramento], ["Iluminação", plan.iluminacao], ["Texto", plan.texto],
    ["Logo", plan.logo], ["Assinatura", plan.assinatura], ["Formato", plan.formato?.includes(plan.proporcao) ? plan.formato : `${plan.formato} · ${plan.proporcao}`],
  ];
  const isCarousel = p.contentType === "carrossel";
  return (
    <div className="card">
      <div className="spread">
        <div>
          <div className="eyebrow">Planejamento completo · v{pad(p.version ?? 1)}</div>
          <h2 style={{ marginTop: 4 }}>Conceito {pad(p.conceptNumber ?? 1)} — “{p.conceptTitle}”</h2>
        </div>
        {approved ? <span className="chip chip-ok">🟢 Aprovado</span> : active ? <span className="chip chip-warn">Aguardando aprovação</span> : <span className="chip">Versão anterior</span>}
      </div>
      <div className="plan-grid" style={{ marginTop: 18 }}>
        {fields.map(([k, v]) => (
          <div key={k} className="plan-field"><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 22 }}><h3>{isCarousel ? "Slides" : p.contentType === "reels" ? "Capa" : "Peça"}</h3><span className="tiny muted">cada peça é uma imagem independente</span></div>
      <div className="slides">
        {(plan.pecas ?? []).map((s: any) => (
          <div key={s.numero} className="slide">
            <div className="role">{isCarousel ? "SLIDE" : "PEÇA"} {pad(s.numero)} — {s.papel}</div>
            <div style={{ fontWeight: 600, marginTop: 4 }}>{s.titulo}</div>
            {s.texto_na_arte && <div className="small" style={{ marginTop: 4 }}>Texto: “{s.texto_na_arte}”</div>}
            <div className="tiny muted" style={{ marginTop: 4 }}>{s.descricao_visual}</div>
            <div className="tiny muted">{s.enquadramento}</div>
          </div>
        ))}
      </div>

      {plan.roteiro && (
        <>
          <div className="section-title"><h3>Roteiro do Reels</h3><span className="tiny muted">≈ {plan.roteiro.duracao_total_segundos}s</span></div>
          <div style={{ overflowX: "auto" }}>
            <table className="script-table">
              <thead><tr><th>Etapa</th><th>Texto falado</th><th>Texto na tela</th><th>Cena e enquadramento</th><th>B-roll</th><th>Duração</th></tr></thead>
              <tbody>
                {plan.roteiro.blocos.map((b: any, i: number) => (
                  <tr key={i}>
                    <td><strong>{b.etapa}</strong></td><td>{b.texto_falado}</td><td>{b.texto_na_tela}</td>
                    <td>{b.cena}<div className="tiny muted">{b.enquadramento}</div></td><td>{b.broll}</td><td>{b.duracao_segundos}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid-2" style={{ marginTop: 12 }}>
            <div className="plan-field"><div className="k">Sugestão de edição</div><div className="v">{plan.roteiro.sugestao_edicao}</div></div>
            <div className="plan-field"><div className="k">Objetivo do vídeo</div><div className="v">{plan.roteiro.objetivo_video}</div></div>
          </div>
        </>
      )}

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="card-flat">
          <div className="plan-field"><div className="k">Referências utilizadas</div></div>
          {(plan.referencias_utilizadas ?? []).length === 0 && <div className="small muted">Nenhuma referência aprovada se aplicou.</div>}
          {(plan.referencias_utilizadas ?? []).map((r: any) => (
            <div key={r.id} className="small" style={{ marginTop: 6 }}><a href={`/biblioteca?ref=${r.id}`}>{r.nome}</a>: {r.o_que_absorver}</div>
          ))}
        </div>
        <div className="card-flat">
          <div className="plan-field"><div className="k">Estratégia para Instagram</div></div>
          <div className="small" style={{ marginTop: 6 }}>{plan.estrategia_instagram?.objetivo}</div>
          <div className="small" style={{ marginTop: 4 }}><strong>Legenda:</strong> {plan.estrategia_instagram?.legenda_sugerida}</div>
          <div className="small"><strong>CTA:</strong> {plan.estrategia_instagram?.cta}</div>
          <div className="small"><strong>Melhor uso:</strong> {plan.estrategia_instagram?.melhor_uso}</div>
          <div className="tiny muted" style={{ marginTop: 4 }}>{plan.estrategia_instagram?.hashtags?.join(" ")}</div>
        </div>
      </div>

      {active && !approved && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, marginBottom: 10 }}>Aprovar planejamento?</div>
          <div className="row">
            <button className="btn btn-wood" disabled={busy} onClick={() => onApprove(p.planId)}>👍 Aprovar planejamento</button>
            {!asking && <button className="btn" disabled={busy} onClick={() => setAsking(true)}>✏️ Pedir alteração</button>}
          </div>
          {asking && (
            <div className="row" style={{ marginTop: 10 }}>
              <input className="input" style={{ flex: 1, minWidth: 220 }} autoFocus placeholder="O que precisa mudar no planejamento?" value={notes} onChange={(e) => setNotes(e.target.value)} />
              <button className="btn btn-primary btn-sm" disabled={busy || !notes.trim()} onClick={() => { onRevise(notes); setAsking(false); setNotes(""); }}>Revisar planejamento</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QualityCard({ msg }: { msg: ChatMessage }) {
  const review = msg.payload?.review;
  const pieces: any[] = msg.payload?.pieces ?? [];
  const [open, setOpen] = useState(false);
  if (!review) return null;
  return (
    <div className="card-flat">
      <div className="spread">
        <div className="eyebrow">Checklist de qualidade</div>
        <span className={`chip ${review.passed ? "chip-ok" : "chip-warn"}`}>
          {review.passed ? "Aprovado no checklist" : "Pontos de atenção"} · {review.attempts} {review.attempts === 1 ? "rodada" : "rodadas"}
        </span>
      </div>
      <p className="small" style={{ margin: "8px 0" }}>{msg.content}</p>
      <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => setOpen(!open)}>{open ? "Esconder checklist" : "Ver checklist por peça"}</button>
      {open && pieces.map((p) => (
        <div key={p.numero} style={{ marginTop: 10 }}>
          <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Peça {pad(p.numero)}</div>
          <div className="checklist">
            {p.checklist.map((c: any) => (
              <div key={c.item} title={c.observacao}><span className={c.aprovado ? "ok" : "no"}>{c.aprovado ? "✓" : "✗"}</span> {QUALITY_LABEL[c.item] ?? c.item}</div>
            ))}
          </div>
        </div>
      ))}
      {open && review.history?.length > 1 && (
        <div className="tiny muted" style={{ marginTop: 10 }}>
          {review.history.map((h: any) => <div key={h.attempt}>Rodada {h.attempt}: {h.failed.length ? `revisado por ${h.failed.join("; ")}` : "tudo aprovado"}</div>)}
        </div>
      )}
    </div>
  );
}
