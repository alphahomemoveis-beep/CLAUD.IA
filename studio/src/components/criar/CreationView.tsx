"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { FORMAT_INFO, type Format } from "@/lib/criar/formats";
import { MediaPicker } from "../agenda/MediaPicker";
import { NewPost } from "../agenda/NewPost";
import type { Post } from "../agenda/PostCard";
import { Modal } from "../Modal";
import { STATUS_LABEL } from "./CriarHome";
import { StockPicker } from "./StockPicker";

interface Peca { titulo: string; apoio: string; texto: string; fala: string; imagem: string; busca_imagem: string; duracao_s: number }
interface Opcao {
  titulo: string; formato_viral: string; gancho: string; por_que_funciona: string; tendencia_base: string;
  pecas: Peca[]; legenda: string; hashtags: string[]; audio_sugerido: string;
}
interface OptionRow { id: string; round: number; number: number; request: string; data: Opcao; chosen: boolean }
interface Bg { peca: number; origem: "upload" | "pasta" | "banco" | "pexels"; media_type: "image" | "video"; credito?: string; credito_url?: string }
interface Creation {
  id: string; format: Format; theme: string; status: string; error: string | null; chosen_option_id: string | null;
  research: { tendencias: Array<{ tendencia: string; evidencia: string; fonte_url: string }>; fontes: Array<{ url: string; title: string }> } | null;
  backgrounds: Bg[]; output_media_ids: string[]; updated_at: string;
}
interface View { creation: Creation; options: OptionRow[]; hasLogo: boolean; banco: string | null }

const POST_TYPE: Record<Format, Post["post_type"]> = { reels: "REEL", feed: "POST", story: "STORY", carrossel: "CARROSSEL", roteiro: "REEL" };
const WORKING = new Set(["pesquisando", "renderizando"]);

function scriptText(o: Opcao) {
  const lines = [o.titulo.toUpperCase(), `Gancho: ${o.gancho}`, ""];
  o.pecas.forEach((p, i) => {
    lines.push(`CENA ${i + 1}${p.duracao_s ? ` (${p.duracao_s}s)` : ""}`);
    if (p.fala) lines.push(`Fala: ${p.fala}`);
    lines.push(`Na tela: ${p.apoio ? `${p.apoio} / ` : ""}${p.titulo}${p.texto ? ` / ${p.texto}` : ""}`);
    lines.push(`Imagem: ${p.imagem}`, "");
  });
  lines.push("LEGENDA", o.legenda, "", o.hashtags.join(" "));
  if (o.audio_sugerido) lines.push("", `Áudio: ${o.audio_sugerido}`);
  return lines.join("\n");
}

export function CreationView({ id, role }: { id: string; role: string }) {
  const canAct = role === "owner" || role === "editor";
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pedido, setPedido] = useState("");
  const [picker, setPicker] = useState<{ peca: number; kind: "pasta" | "banco" } | null>(null);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  const [bgVersion, setBgVersion] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadFor = useRef(0);

  const load = useCallback(() => api<View>(`/api/criar/${id}`).then(setV).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const status = v?.creation.status;
  useEffect(() => {
    if (!status || !WORKING.has(status)) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [status, load]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const setBg = (body: unknown) => act("fundo", async () => { await api(`/api/criar/${id}/fundos`, { method: "POST", json: body }); setBgVersion((n) => n + 1); });

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("peca", String(uploadFor.current));
    fd.append("file", file);
    await act("fundo", async () => { await api(`/api/criar/${id}/fundos`, { method: "POST", body: fd }); setBgVersion((n) => n + 1); });
  }
  async function uploadLogo(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    await act("logo", () => api("/api/brand/logo", { method: "POST", body: fd }));
  }

  if (!v) return <div className="page">{error ? <div className="alert">{error}</div> : <span className="spinner" />}</div>;
  const c = v.creation;
  const info = FORMAT_INFO[c.format];
  const rounds = [...new Set(v.options.map((o) => o.round))];
  const lastRound = rounds.at(-1);
  const chosen = v.options.find((o) => o.id === c.chosen_option_id) ?? null;
  const tall = info.ratio === "9:16";
  const busyAll = !!busy || WORKING.has(c.status);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link href="/criar">Criar conteúdo</Link> · {info.label}</div>
          <h1>{chosen?.data.titulo ?? (c.theme || `Novo ${info.label.toLowerCase()}`)}</h1>
          {c.theme && chosen && <p className="lead">{c.theme}</p>}
        </div>
        <span className={`chip ${c.status === "pronto" ? "chip-ok" : c.status === "falhou" ? "chip-bad" : "chip-wood"}`}>{STATUS_LABEL[c.status]}</span>
      </div>

      {error && <div className="alert" style={{ marginBottom: 14 }}>{error}</div>}
      {c.error && <div className="alert" style={{ marginBottom: 14 }}>{c.error}</div>}

      {c.status === "pesquisando" && (
        <div className="working" style={{ marginBottom: 20 }}>
          <div className={`step ${v.options.length ? "done" : "now"}`}><span className="dot" />{v.options.length ? "Tendências já pesquisadas" : "Pesquisando o que está viralizando no Instagram…"}</div>
          <div className="step now"><span className="dot" />Escrevendo 3 opções para {info.label.toLowerCase()} (pode levar até 2 minutos)</div>
        </div>
      )}

      {c.research && c.research.tendencias.length > 0 && (
        <details className="card card-flat" style={{ marginBottom: 20 }}>
          <summary><strong>O que está em alta agora</strong> <span className="small muted">({c.research.tendencias.length} {c.research.tendencias.length === 1 ? "tendência" : "tendências"})</span></summary>
          <ul className="small" style={{ marginTop: 10 }}>
            {c.research.tendencias.map((t, i) => (
              <li key={i} style={{ marginBottom: 6 }}><strong>{t.tendencia}.</strong> {t.evidencia} {t.fonte_url && <a href={t.fonte_url} target="_blank" rel="noreferrer">fonte</a>}</li>
            ))}
          </ul>
          {c.research.fontes.length > 0 && <div className="tiny muted">Fontes: {c.research.fontes.slice(0, 8).map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{f.title}</a>)}</div>}
        </details>
      )}

      {rounds.map((r) => {
        const opts = v.options.filter((o) => o.round === r);
        const body = (
          <div className="concepts" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {opts.map((o) => <OptionCard key={o.id} o={o} chosen={o.id === c.chosen_option_id} disabled={!canAct || busyAll}
              onChoose={() => act("escolher", () => api(`/api/criar/${id}/escolher`, { method: "POST", json: { opcaoId: o.id } }))} />)}
          </div>
        );
        return r === lastRound && !chosen ? (
          <section key={r} style={{ marginBottom: 22 }}>
            <div className="section-title">Rodada {r}{opts[0]?.request ? `: "${opts[0].request}"` : ""}</div>
            {body}
          </section>
        ) : (
          <details key={r} style={{ marginBottom: 14 }} open={r === lastRound && !chosen}>
            <summary className="small"><strong>Rodada {r}</strong> <span className="muted">({opts.length} opções{opts.some((o) => o.chosen) ? ", com a escolhida" : ""})</span></summary>
            <div style={{ marginTop: 10 }}>{body}</div>
          </details>
        );
      })}

      {canAct && v.options.length > 0 && c.status !== "pesquisando" && (
        <form className="card card-flat stack" style={{ marginBottom: 26 }} onSubmit={(e) => { e.preventDefault(); act("rodada", async () => { await api(`/api/criar/${id}/opcoes`, { method: "POST", json: { pedido } }); setPedido(""); }); }}>
          <strong>{chosen ? "Quer ver outras ideias?" : "Nenhuma serviu?"}</strong>
          <input className="input" value={pedido} onChange={(e) => setPedido(e.target.value)} maxLength={600} placeholder="O que mudar? Ex.: mais curto, falar de closet, tom mais divertido (opcional)" />
          <div><button className="btn" disabled={busyAll}>{busy === "rodada" ? <span className="spinner" /> : "↻ Criar 3 novas opções"}</button></div>
        </form>
      )}

      {chosen && c.format !== "roteiro" && (
        <section className="stack" style={{ marginBottom: 26 }}>
          <div className="section-title">Logo e fundos</div>
          <div className="card card-flat row" style={{ alignItems: "center", gap: 16 }}>
            {v.hasLogo ? <img src={`/api/brand/logo?v=${c.updated_at}`} alt="Logo da marca" style={{ height: 48, maxWidth: 160, objectFit: "contain", background: "#2a2018", padding: 6, borderRadius: 8 }} /> : <span className="chip chip-warn">Sem logo</span>}
            <div className="stack" style={{ gap: 4, flex: 1, minWidth: 200 }}>
              <span className="small">{v.hasLogo ? "A logo salva entra em todas as artes." : "Envie a logo uma vez: ela fica salva na memória da marca."}</span>
              <span className="tiny muted">PNG com fundo transparente fica melhor.</span>
            </div>
            {role === "owner"
              ? <label className="btn btn-sm">{busy === "logo" ? <span className="spinner" /> : v.hasLogo ? "Trocar logo" : "Enviar logo"}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} /></label>
              : !v.hasLogo && <span className="tiny muted">Só a dona da conta envia a logo.</span>}
          </div>

          <div className="spread">
            <span className="small muted">Escolha um fundo para cada {c.format === "reels" ? "cena" : "página"}. Sem fundo, entra a madeira com luz de LED da marca.</span>
            {canAct && v.banco && <button className="btn btn-sm" disabled={busyAll} onClick={() => setBg({ origem: "auto" })}>{busy === "fundo" ? <span className="spinner" /> : `✨ Completar com fotos do ${v.banco}`}</button>}
          </div>
          {!v.banco && <div className="tiny muted">Busca de fotos desligada: cadastre <code>PIXABAY_API_KEY</code> (grátis em pixabay.com/api/docs) para buscar fotos e vídeos sem sair do app.</div>}

          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
          <div className="images" style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${tall ? 150 : 170}px, 1fr))`, gap: 12 }}>
            {chosen.data.pecas.map((p, i) => {
              const bg = c.backgrounds.find((b) => b.peca === i);
              const src = `/api/criar/${id}/fundos/${i}?v=${bgVersion}-${c.updated_at}`;
              return (
                <div key={i} className="tile">
                  <div className={`frame ${tall ? "tall" : ""} bg-frame`}>
                    {bg ? (bg.media_type === "video" ? <video src={src} muted playsInline loop autoPlay /> : <img src={src} alt="" />) : <div className="bg-placeholder" />}
                    <div className="bg-text"><span className="apoio">{p.apoio}</span><span className="titulo">{p.titulo}</span></div>
                    <span className="badge chip">{i + 1}</span>
                  </div>
                  <div className="meta">
                    <span className="tiny muted" title={p.imagem}>{p.imagem}</span>
                    {bg?.credito && <a className="tiny" href={bg.credito_url} target="_blank" rel="noreferrer">{bg.credito}</a>}
                    {canAct && (
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn btn-xs" title="Enviar foto ou vídeo" disabled={busyAll} onClick={() => { uploadFor.current = i; fileRef.current?.click(); }}>📤</button>
                        <button className="btn btn-xs" title="Escolher das Pastas" disabled={busyAll} onClick={() => setPicker({ peca: i, kind: "pasta" })}>🗂️</button>
                        {v.banco && <button className="btn btn-xs" title={`Buscar no ${v.banco}`} disabled={busyAll} onClick={() => setPicker({ peca: i, kind: "banco" })}>🔎</button>}
                        {bg && <button className="btn btn-xs" title="Tirar o fundo" disabled={busyAll} onClick={() => setBg({ origem: "remover", peca: i })}>✕</button>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {canAct && (
            <div className="row">
              <button className="btn btn-primary" disabled={busyAll} onClick={() => act("gerar", () => api(`/api/criar/${id}/gerar`, { method: "POST" }))}>
                {c.status === "renderizando" ? <><span className="spinner" /> Montando{c.format === "reels" ? " o vídeo (uns 30 a 90 segundos)" : " as artes"}…</> : c.status === "pronto" ? "↻ Gerar de novo" : c.format === "reels" ? "🎬 Gerar o vídeo" : `🎨 Gerar ${chosen.data.pecas.length > 1 ? "as artes" : "a arte"}`}
              </button>
            </div>
          )}
        </section>
      )}

      {c.status === "pronto" && c.output_media_ids.length > 0 && chosen && (
        <section className="stack" style={{ marginBottom: 26 }}>
          <div className="section-title">Resultado</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${c.format === "reels" ? 240 : 200}px, 1fr))`, gap: 12 }}>
            {c.output_media_ids.map((m, i) => (
              <div key={m} className="tile">
                <div className={`frame ${tall ? "tall" : ""}`}>
                  {c.format === "reels" ? <video src={`/api/folder-media/${m}/file`} controls playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <img src={`/api/folder-media/${m}/file`} alt={`Peça ${i + 1}`} />}
                </div>
                <div className="meta"><a className="btn btn-xs" href={`/api/folder-media/${m}/file?baixar=1`}>⬇ Baixar</a></div>
              </div>
            ))}
          </div>
          <div className="tiny muted">Também salvo em 🗂️ Pastas &gt; Criações do app.</div>
        </section>
      )}

      {chosen && (c.status === "pronto" || c.format === "roteiro") && (
        <section className="stack" style={{ marginBottom: 26 }}>
          {(c.format === "reels" || c.format === "roteiro") && (
            <>
              <div className="section-title">Roteiro para gravar</div>
              <div style={{ overflowX: "auto" }}>
                <table className="script-table">
                  <thead><tr><th>#</th><th>Fala</th><th>Na tela</th><th>Imagem</th><th>s</th></tr></thead>
                  <tbody>{chosen.data.pecas.map((p, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{p.fala}</td><td><em>{p.apoio}</em> <strong>{p.titulo}</strong>{p.texto ? ` · ${p.texto}` : ""}</td><td>{p.imagem}</td><td>{p.duracao_s || ""}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
          <div className="card card-flat stack">
            <div className="spread"><strong>Legenda</strong>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-xs" onClick={() => navigator.clipboard.writeText(`${chosen.data.legenda}\n\n${chosen.data.hashtags.join(" ")}`)}>Copiar</button>
                <a className="btn btn-xs" download={`${chosen.data.titulo.slice(0, 40)}.txt`} href={`data:text/plain;charset=utf-8,${encodeURIComponent(scriptText(chosen.data))}`}>⬇ Texto completo</a>
              </div>
            </div>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>{chosen.data.legenda}</div>
            <div className="small muted">{chosen.data.hashtags.join(" ")}</div>
            {chosen.data.audio_sugerido && <div className="small">🎵 Áudio: {chosen.data.audio_sugerido} <span className="muted">(escolha no Instagram na hora de postar)</span></div>}
          </div>
          {canAct && c.format !== "roteiro" && c.output_media_ids.length > 0 && (
            <div className="row">
              <button className="btn btn-wood" onClick={() => setPosting(true)}>📅 Mandar para a Agenda</button>
              {posted && <Link className="small" href="/agenda">Rascunho criado. Ver na Agenda →</Link>}
            </div>
          )}
        </section>
      )}

      {picker?.kind === "pasta" && (
        <MediaPicker initial={[]} onClose={() => setPicker(null)} onPick={(ids) => { const p = picker.peca; setPicker(null); if (ids[0]) setBg({ origem: "pasta", peca: p, mediaId: ids[0].id }); }} />
      )}
      {picker?.kind === "banco" && chosen && v.banco && (
        <StockPicker banco={v.banco} initialQuery={chosen.data.pecas[picker.peca]?.busca_imagem ?? ""} video={c.format === "reels"} onClose={() => setPicker(null)}
          onPick={(it) => { const p = picker.peca; setPicker(null); setBg({ origem: "banco", peca: p, bancoId: it.id, tipo: it.tipo }); }} />
      )}
      {posting && chosen && (
        <NewPost initialMedia={c.output_media_ids.map((m, i) => ({ id: m, label: `Criação · ${i + 1} · ${c.format === "reels" ? "vídeo" : "foto"}` }))}
          initial={{ type: c.output_media_ids.length > 1 ? "CARROSSEL" : POST_TYPE[c.format], caption: chosen.data.legenda, hashtags: chosen.data.hashtags.join(" ") }}
          onClose={() => setPosting(false)} onCreated={(p) => { setPosting(false); setPosted(p.id); }} />
      )}
      {busy === "fundo" && !picker && <Modal title="Preparando o fundo" onClose={() => undefined}><div className="row"><span className="spinner" /> Baixando e salvando…</div></Modal>}
    </div>
  );
}

function OptionCard({ o, chosen, disabled, onChoose }: { o: OptionRow; chosen: boolean; disabled: boolean; onChoose: () => void }) {
  const d = o.data;
  return (
    <div className={`concept ${chosen ? "chosen" : ""}`}>
      <div className="spread"><span className="num">OPÇÃO {o.number}</span><span className="chip chip-wood">{d.formato_viral}</span></div>
      <h3>{d.titulo}</h3>
      <div className="quote">“{d.gancho}”</div>
      <div className="small">{d.por_que_funciona}</div>
      {d.tendencia_base && <div className="tiny muted">Tendência: {d.tendencia_base}</div>}
      <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
        {d.pecas.map((p, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            <strong>{p.titulo}</strong>{p.apoio ? <em> · {p.apoio}</em> : null}
            {p.fala ? <div className="muted">🎙️ {p.fala}</div> : p.texto ? <div className="muted">{p.texto}</div> : null}
          </li>
        ))}
      </ol>
      <details className="small"><summary>Legenda</summary><div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{d.legenda}</div><div className="muted">{d.hashtags.join(" ")}</div></details>
      <button className={`btn ${chosen ? "btn-wood" : "btn-primary"}`} disabled={disabled} onClick={onChoose}>{chosen ? "✓ Escolhida" : "Escolher esta"}</button>
    </div>
  );
}
