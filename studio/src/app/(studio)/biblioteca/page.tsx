"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { CATEGORIES, REF_STATUS } from "@/lib/labels";
import { Toast } from "@/components/Modal";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Ref {
  id: string; name: string; category: string; status: string; favorite: boolean; rating: number | null;
  media_type: string; mime_type: string; file_size: number; source: string; visual_description: string; environment: string;
  palette: Array<{ nome: string; hex: string }>; materials: string[]; style: string; recommended_use: string;
  analysis: any; analysis_error: string | null; user_notes: string; tags: string[]; created_at: string; analyzed_at: string | null;
}

const SPECIAL = [
  { id: "favoritas", label: "Favoritas", icon: "⭐" },
  { id: "aprovadas", label: "Aprovadas", icon: "🟢" },
  { id: "rejeitadas", label: "Rejeitadas", icon: "❌" },
  { id: "em_avaliacao", label: "Em avaliação", icon: "🟡" },
  { id: "referencia", label: "Referência", icon: "🔵" },
];

export default function LibraryPage() {
  const [refs, setRefs] = useState<Ref[] | null>(null);
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Ref | null>(null);
  const [uploads, setUploads] = useState<Array<{ name: string; state: string }>>([]);
  const [upCategory, setUpCategory] = useState("ambientes");
  const [upTags, setUpTags] = useState("");
  const [upNotes, setUpNotes] = useState("");
  const [over, setOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const sp = new URLSearchParams();
    if (category) sp.set("categoria", category);
    if (filter) sp.set("filtro", filter);
    if (q) sp.set("q", q);
    return api<{ references: Ref[] }>(`/api/references?${sp}`).then((d) => setRefs(d.references));
  }, [category, filter, q]);

  useEffect(() => { const t = setTimeout(() => load().catch((e) => setToast(e.message)), q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ref");
    if (id) api<{ reference: Ref }>(`/api/references/${id}`).then((d) => setOpen(d.reference)).catch(() => undefined);
  }, []);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    setUploads(list.map((f) => ({ name: f.name, state: "Enviando e analisando…" })));
    for (const [i, f] of list.entries()) {
      const form = new FormData();
      form.set("file", f);
      form.set("category", upCategory);
      if (upTags) form.set("tags", upTags);
      if (upNotes) form.set("notes", upNotes);
      try {
        const res = await api<{ reference: Ref }>("/api/references", { method: "POST", body: form });
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: res.reference.analysis_error ? "Guardada (sem análise automática)" : "Analisada ✓" } : x)));
      } catch (err) {
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, state: `Recusada: ${(err as Error).message}` } : x)));
      }
    }
    load();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      const d = await api<{ reference: Ref }>(`/api/references/${id}`, { method: "PATCH", json: body });
      setOpen(d.reference);
      setRefs((r) => r?.map((x) => (x.id === id ? d.reference : x)) ?? null);
    } catch (err) {
      setToast((err as Error).message);
    }
  }

  async function reanalyze(id: string) {
    setToast("Analisando de novo…");
    try {
      const d = await api<{ reference: Ref }>(`/api/references/${id}/analyze`, { method: "POST" });
      setOpen(d.reference);
      load();
      setToast("Análise atualizada.");
    } catch (err) {
      setToast((err as Error).message);
    }
  }

  async function remove(r: Ref) {
    if (!window.confirm(`Apagar a referência "${r.name}"? Esta ação não pode ser desfeita.`)) return;
    await api(`/api/references/${r.id}?confirmar=sim`, { method: "DELETE" });
    setOpen(null);
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">🖼️ Biblioteca visual</div>
          <h1>Memória visual da marca</h1>
          <p className="lead">Cada referência é analisada pela IA e guardada com descrição, paleta, materiais e tags. As aprovadas e favoritas entram automaticamente nas próximas criações. Nenhum modelo é retreinado.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="grid-3" style={{ marginBottom: 14 }}>
          <label className="field"><span className="label">Categoria</span>
            <select className="select" value={upCategory} onChange={(e) => setUpCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">Tags (separadas por vírgula)</span>
            <input className="input" value={upTags} onChange={(e) => setUpTags(e.target.value)} placeholder="cozinha, freijó, led" />
          </label>
          <label className="field"><span className="label">Notas para a análise</span>
            <input className="input" value={upNotes} onChange={(e) => setUpNotes(e.target.value)} placeholder="O que esta referência tem de bom" />
          </label>
        </div>
        <div
          className={`dropzone ${over ? "over" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
          role="button"
          tabIndex={0}
        >
          <div style={{ fontFamily: "var(--font-display)", fontSize: 22 }}>Arraste imagens, prints, fotos ou vídeos</div>
          <div className="small muted">JPG, PNG, WEBP, GIF, MP4, MOV ou WEBM. O arquivo é conferido pelo conteúdo, não pela extensão.</div>
          <input ref={fileRef} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            onChange={(e) => e.target.files && upload(e.target.files)} />
        </div>
        {uploads.length > 0 && (
          <div className="stack" style={{ marginTop: 12, gap: 4 }}>
            {uploads.map((u, i) => <div key={i} className="small spread"><span>{u.name}</span><span className="muted">{u.state}</span></div>)}
          </div>
        )}
      </div>

      <div className="filters">
        <button className={`chip ${!category && !filter ? "on" : ""}`} onClick={() => { setCategory(""); setFilter(""); }}>Todas</button>
        {CATEGORIES.map((c) => <button key={c.id} className={`chip ${category === c.id ? "on" : ""}`} onClick={() => setCategory(category === c.id ? "" : c.id)}>{c.icon} {c.label}</button>)}
      </div>
      <div className="filters">
        {SPECIAL.map((s) => <button key={s.id} className={`chip ${filter === s.id ? "on" : ""}`} onClick={() => setFilter(filter === s.id ? "" : s.id)}>{s.icon} {s.label}</button>)}
        <input className="input" style={{ maxWidth: 260, marginLeft: "auto" }} placeholder="Buscar por nome, descrição ou tag" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!refs && <span className="spinner" />}
      {refs && refs.length === 0 && <div className="empty">Nenhuma referência neste filtro.</div>}
      {refs && refs.length > 0 && (
        <div className="lib-grid">
          {refs.map((r) => (
            <button key={r.id} className="ref-card" onClick={() => setOpen(r)}>
              <div className="thumb">
                {r.media_type === "video" ? <video src={`/api/references/${r.id}/file`} muted /> : <img src={`/api/references/${r.id}/file`} alt={r.name} loading="lazy" />}
                {r.favorite && <span className="fav">⭐</span>}
              </div>
              <div className="body">
                <div className="name">{r.name}</div>
                <div className="row" style={{ gap: 4 }}>
                  <span className={`chip ${REF_STATUS[r.status]?.tone}`}>{REF_STATUS[r.status]?.icon} {REF_STATUS[r.status]?.label}</span>
                  <span className="chip">{CATEGORIES.find((c) => c.id === r.category)?.icon} {CATEGORIES.find((c) => c.id === r.category)?.label}</span>
                </div>
                {r.palette?.length > 0 && <div className="palette">{r.palette.slice(0, 6).map((c, i) => <span key={i} className="swatch" style={{ background: c.hex, width: 16, height: 16 }} title={c.nome} />)}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && <RefDrawer r={open} onClose={() => setOpen(null)} onPatch={patch} onReanalyze={reanalyze} onRemove={remove} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function RefDrawer({ r, onClose, onPatch, onReanalyze, onRemove }: {
  r: Ref; onClose: () => void; onPatch: (id: string, b: Record<string, unknown>) => void; onReanalyze: (id: string) => void; onRemove: (r: Ref) => void;
}) {
  const [name, setName] = useState(r.name);
  const [notes, setNotes] = useState(r.user_notes);
  const [tags, setTags] = useState(r.tags.join(", "));
  useEffect(() => { setName(r.name); setNotes(r.user_notes); setTags(r.tags.join(", ")); }, [r]);
  const a = r.analysis;
  const fields: Array<[string, any]> = a ? [
    ["Ambiente", a.ambiente], ["Estilo", a.estilo], ["Materiais", a.materiais?.join(", ")], ["Iluminação", a.iluminacao],
    ["Enquadramento", a.enquadramento], ["Composição", a.composicao], ["Arquitetura", a.arquitetura], ["Móveis", a.moveis?.join(", ")],
    ["Nível de realismo", a.nivel_realismo], ["Tipografia", a.tipografia], ["Direção de arte", a.direcao_arte], ["Sensação", a.sensacao],
    ["Características", a.caracteristicas_interessantes?.join("; ")], ["Evitar", a.evitar?.join("; ")], ["Usos recomendados", a.usos_recomendados?.join("; ")],
  ] : [];

  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label={r.name}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <div className="eyebrow">Referência · incluída em {fmtDate(r.created_at, false)}</div>
          <button className="btn btn-ghost icon-btn" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div style={{ borderRadius: 12, overflow: "hidden", background: "var(--surface-3)" }}>
          {r.media_type === "video"
            ? <video src={`/api/references/${r.id}/file`} controls style={{ width: "100%" }} />
            : <img src={`/api/references/${r.id}/file`} alt={r.name} style={{ width: "100%", maxHeight: 460, objectFit: "contain" }} />}
        </div>

        <div className="stack" style={{ marginTop: 18 }}>
          <div className="row">
            {Object.entries(REF_STATUS).map(([k, v]) => (
              <button key={k} className={`chip ${r.status === k ? "on" : ""}`} title={v.help} onClick={() => onPatch(r.id, { status: k })}>{v.icon} {v.label}</button>
            ))}
            <button className={`chip ${r.favorite ? "on" : ""}`} onClick={() => onPatch(r.id, { favorite: !r.favorite })}>⭐ Favorita</button>
          </div>
          <div className="tiny muted">{REF_STATUS[r.status]?.help}</div>
          <div className="row">
            <span className="small muted">Avaliação:</span>
            <span className="stars">
              {[1, 2, 3, 4, 5].map((n) => <button key={n} className={(r.rating ?? 0) >= n ? "on" : ""} aria-label={`${n} estrelas`} onClick={() => onPatch(r.id, { rating: r.rating === n ? null : n })}>★</button>)}
            </span>
          </div>

          <label className="field"><span className="label">Nome</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== r.name && name.trim() && onPatch(r.id, { name })} /></label>
          <div className="grid-2">
            <label className="field"><span className="label">Categoria</span>
              <select className="select" value={r.category} onChange={(e) => onPatch(r.id, { category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
            </label>
            <label className="field"><span className="label">Tags</span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => onPatch(r.id, { tags: tags.split(",").map((t) => t.trim()).filter(Boolean) })} /></label>
          </div>
          <label className="field"><span className="label">Notas da marca</span><textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== r.user_notes && onPatch(r.id, { user_notes: notes })} /></label>

          <hr className="divider" />
          <div className="spread">
            <h3>Análise da IA</h3>
            <button className="btn btn-sm" onClick={() => onReanalyze(r.id)}>Analisar de novo</button>
          </div>
          {r.analysis_error && <div className="alert alert-warn small">{r.analysis_error}</div>}
          {r.visual_description && <p style={{ margin: 0 }}>{r.visual_description}</p>}
          {r.palette?.length > 0 && (
            <div className="palette">{r.palette.map((c, i) => <div key={i} className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: c.hex }} /><span className="tiny">{c.nome} {c.hex}</span></div>)}</div>
          )}
          {fields.length > 0 && <dl className="kv">{fields.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>}
          <hr className="divider" />
          <div className="spread">
            <span className="tiny muted">{r.mime_type} · {(r.file_size / 1024 / 1024).toFixed(2)} MB · {r.source === "gerada" ? "criada no estúdio" : "enviada"} · ID {r.id.slice(0, 8)}</span>
            <button className="btn btn-sm btn-danger" onClick={() => onRemove(r)}>Apagar</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
