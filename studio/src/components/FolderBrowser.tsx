"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { Modal, Toast } from "./Modal";

interface FolderCard {
  id: string; name: string; description: string; address: string; client_name: string;
  subfolders: number; projeto: number; obra: number; resultado: number;
  cover_media_id: string | null; cover_media_type: string | null; updated_at: string;
}
interface Media {
  id: string; stage: Stage; media_type: "image" | "video"; mime_type: string; file_size: number;
  original_name: string; caption: string; reference_id: string | null; created_at: string;
}
type Stage = "projeto" | "obra" | "resultado";
interface Detail { folder: FolderCard & { parent_id: string | null }; path: Array<{ id: string; name: string }>; children: FolderCard[]; media: Media[] }

const STAGES: Array<{ id: Stage; label: string; icon: string; help: string }> = [
  { id: "projeto", label: "Projeto", icon: "📐", help: "Renders, plantas e imagens do projeto." },
  { id: "obra", label: "Obra", icon: "🛠️", help: "Fotos e vídeos da execução e da montagem." },
  { id: "resultado", label: "Resultado", icon: "✨", help: "O ambiente pronto: fotos e vídeos finais." },
];

export function FolderBrowser({ id }: { id?: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [root, setRoot] = useState<FolderCard[] | null>(null);
  const [stage, setStage] = useState<Stage>("resultado");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [zoom, setZoom] = useState<Media | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (id) setDetail(await api<Detail>(`/api/folders/${id}`));
    else setRoot((await api<{ folders: FolderCard[] }>("/api/folders")).folders);
  }, [id]);

  useEffect(() => { load().catch((e) => setToast(e.message)); }, [load]);

  async function upload(files: FileList | File[]) {
    if (!id) return;
    const list = [...files];
    const form = new FormData();
    form.set("stage", stage);
    list.forEach((f) => form.append("file", f));
    setUploading(`Enviando ${list.length} ${list.length === 1 ? "arquivo" : "arquivos"}…`);
    try {
      const res = await fetch(`/api/folders/${id}/media`, { method: "POST", body: form, credentials: "same-origin" });
      const data = await res.json();
      const ok = data.created?.length ?? 0;
      const bad = (data.rejected ?? []) as Array<{ name: string; reason: string }>;
      setToast(`${ok} ${ok === 1 ? "arquivo enviado" : "arquivos enviados"}${bad.length ? `. Recusados: ${bad.map((b) => `${b.name} (${b.reason})`).join("; ")}` : "."}${data.error ? ` ${data.error}` : ""}`);
      await load();
    } catch (err) {
      setToast((err as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function updateMedia(m: Media, body: Record<string, unknown>) {
    await api(`/api/folder-media/${m.id}`, { method: "PATCH", json: body });
    await load();
  }
  async function removeMedia(m: Media) {
    if (!window.confirm(`Apagar "${m.original_name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api(`/api/folder-media/${m.id}?confirmar=sim`, { method: "DELETE" });
      setZoom(null);
      await load();
    } catch (err) { setToast((err as Error).message); }
  }
  async function toLibrary(m: Media) {
    setToast("Enviando para a Biblioteca visual e analisando…");
    try {
      await api(`/api/folder-media/${m.id}/to-library`, { method: "POST" });
      setToast("Foto enviada para a Biblioteca visual como referência em avaliação.");
      await load();
    } catch (err) { setToast((err as Error).message); }
  }
  async function removeFolder() {
    if (!detail) return;
    const typed = window.prompt(`Isto apaga "${detail.folder.name}", as subpastas e todas as fotos e vídeos. Digite o nome exato da pasta para confirmar:`);
    if (typed === null) return;
    try {
      await api(`/api/folders/${detail.folder.id}?confirmar=${encodeURIComponent(typed)}`, { method: "DELETE" });
      window.location.href = detail.folder.parent_id ? `/pastas/${detail.folder.parent_id}` : "/pastas";
    } catch (err) { setToast((err as Error).message); }
  }

  const children = id ? detail?.children : root;
  const media = detail?.media.filter((m) => m.stage === stage) ?? [];
  const count = (s: Stage) => detail?.media.filter((m) => m.stage === s).length ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/pastas">🗂️ Pastas</Link>
            {detail?.path.map((p) => <span key={p.id}> / <Link href={`/pastas/${p.id}`}>{p.name}</Link></span>)}
          </div>
          <h1>{detail ? detail.folder.name : "Pastas de obras"}</h1>
          {!detail && <p className="lead">Organize por condomínio, casa ou cliente. Cada pasta guarda as imagens do Projeto, da Obra e do Resultado.</p>}
          {detail && (
            <div className="row small muted" style={{ marginTop: 6 }}>
              {detail.folder.client_name && <span>Cliente: {detail.folder.client_name}</span>}
              {detail.folder.address && <span>· {detail.folder.address}</span>}
              {detail.folder.description && <span>· {detail.folder.description}</span>}
            </div>
          )}
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>＋ {id ? "Nova subpasta" : "Nova pasta"}</button>
          {detail && <button className="btn" onClick={() => setEditing(true)}>Editar</button>}
          {detail && <button className="btn btn-danger" onClick={removeFolder}>Apagar</button>}
        </div>
      </div>

      {children && children.length > 0 && (
        <>
          {id && <div className="section-title" style={{ marginTop: 0 }}><h3>Subpastas</h3></div>}
          <div className="proj-grid" style={{ marginBottom: 28 }}>
            {children.map((f) => (
              <Link key={f.id} href={`/pastas/${f.id}`} className="proj-card">
                <div className="cover">
                  {f.cover_media_id
                    ? f.cover_media_type === "video"
                      ? <video src={`/api/folder-media/${f.cover_media_id}/file#t=0.5`} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <img src={`/api/folder-media/${f.cover_media_id}/file`} alt="" loading="lazy" />
                    : <span className="ph">🗂️</span>}
                </div>
                <div className="body">
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 21, lineHeight: 1.2 }}>{f.name}</div>
                  {(f.client_name || f.address) && <div className="small muted">{[f.client_name, f.address].filter(Boolean).join(" · ")}</div>}
                  <div className="row" style={{ gap: 6 }}>
                    <span className="chip">📐 {f.projeto}</span><span className="chip">🛠️ {f.obra}</span><span className="chip chip-ok">✨ {f.resultado}</span>
                    {f.subfolders > 0 && <span className="chip chip-wood">{f.subfolders} {f.subfolders === 1 ? "subpasta" : "subpastas"}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
      {!id && root && root.length === 0 && (
        <div className="empty">Nenhuma pasta ainda. Crie a primeira, por exemplo “Condomínio La Paloma”, e dentro dela “Casa 12”.</div>
      )}

      {detail && (
        <>
          <div className="tabs">
            {STAGES.map((s) => (
              <button key={s.id} className={stage === s.id ? "on" : ""} onClick={() => setStage(s.id)}>{s.icon} {s.label} ({count(s.id)})</button>
            ))}
          </div>
          <div
            className={`dropzone ${over ? "over" : ""}`}
            style={{ marginBottom: 18 }}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
            role="button" tabIndex={0}
          >
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>{uploading ?? `Enviar para ${STAGES.find((s) => s.id === stage)!.label}`}</div>
            <div className="small muted">{STAGES.find((s) => s.id === stage)!.help} Fotos e vídeos, vários de uma vez.</div>
            <input ref={fileRef} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
              onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
          </div>
          {media.length === 0 && <div className="empty">Nada em {STAGES.find((s) => s.id === stage)!.label} ainda.</div>}
          <div className="lib-grid">
            {media.map((m) => (
              <div key={m.id} className="ref-card" style={{ cursor: "default" }}>
                <div className="thumb" onClick={() => setZoom(m)} style={{ cursor: "zoom-in" }}>
                  {m.media_type === "video"
                    ? <video src={`/api/folder-media/${m.id}/file#t=0.5`} muted preload="metadata" />
                    : <img src={`/api/folder-media/${m.id}/file`} alt={m.caption || m.original_name} loading="lazy" />}
                  {m.media_type === "video" && <span className="video-badge">▶ Vídeo</span>}
                  {m.reference_id && <span className="fav" title="Na Biblioteca visual">🖼️</span>}
                </div>
                <div className="body">
                  <div className="name" title={m.original_name}>{m.caption || m.original_name}</div>
                  <div className="tiny muted">{fmtDate(m.created_at)} · {m.file_size < 1024 * 1024 ? `${Math.max(1, Math.round(m.file_size / 1024))} KB` : `${(m.file_size / 1024 / 1024).toFixed(1)} MB`}</div>
                  <div className="row" style={{ gap: 4 }}>
                    <Link className="btn btn-xs btn-primary" href={`/agenda?midia=${m.id}`}>Agendar post</Link>
                    <button className="btn btn-xs btn-ghost" onClick={() => setZoom(m)}>Abrir</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {zoom && (
        <Modal title={zoom.caption || zoom.original_name} onClose={() => setZoom(null)}>
          <div style={{ background: "var(--surface-3)", borderRadius: 10, overflow: "hidden" }}>
            {zoom.media_type === "video"
              ? <video src={`/api/folder-media/${zoom.id}/file`} controls style={{ width: "100%", maxHeight: "60vh" }} />
              : <img src={`/api/folder-media/${zoom.id}/file`} alt="" style={{ width: "100%", maxHeight: "60vh", objectFit: "contain" }} />}
          </div>
          <MediaEditor m={zoom} onSave={async (b) => { await updateMedia(zoom, b); setZoom(null); }} />
          <div className="row" style={{ marginTop: 12 }}>
            <Link className="btn btn-sm btn-primary" href={`/agenda?midia=${zoom.id}`}>Agendar post</Link>
            <a className="btn btn-sm" href={`/api/folder-media/${zoom.id}/file?baixar=1`}>Baixar</a>
            {zoom.media_type === "image" && !zoom.reference_id && <button className="btn btn-sm" onClick={() => toLibrary(zoom)}>Para a biblioteca</button>}
            <button className="btn btn-sm btn-danger" onClick={() => removeMedia(zoom)}>Apagar</button>
          </div>
        </Modal>
      )}
      {creating && <FolderForm title={id ? "Nova subpasta" : "Nova pasta"} onClose={() => setCreating(false)}
        onSave={async (b) => {
          await api("/api/folders", { method: "POST", json: { ...b, parent_id: id ?? null } });
          setCreating(false);
          await load();
        }} />}
      {editing && detail && <FolderForm title="Editar pasta" initial={detail.folder} onClose={() => setEditing(false)}
        onSave={async (b) => {
          await api(`/api/folders/${detail.folder.id}`, { method: "PATCH", json: b });
          setEditing(false);
          await load();
        }} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function MediaEditor({ m, onSave }: { m: Media; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [caption, setCaption] = useState(m.caption);
  const [stage, setStage] = useState<Stage>(m.stage);
  return (
    <div className="grid-2" style={{ marginTop: 12, alignItems: "end" }}>
      <label className="field"><span className="label">Descrição</span><input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Ex.: cozinha com LED aceso" /></label>
      <div className="row">
        <select className="select" style={{ width: "auto" }} value={stage} onChange={(e) => setStage(e.target.value as Stage)} aria-label="Etapa">
          {STAGES.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
        </select>
        <button className="btn btn-sm" disabled={caption === m.caption && stage === m.stage} onClick={() => onSave({ caption, stage })}>Salvar</button>
      </div>
    </div>
  );
}

function FolderForm({ title, initial, onClose, onSave }: {
  title: string; initial?: Partial<FolderCard>; onClose: () => void;
  onSave: (b: { name: string; client_name: string; address: string; description: string }) => Promise<void>;
}) {
  const [f, setF] = useState({ name: initial?.name ?? "", client_name: initial?.client_name ?? "", address: initial?.address ?? "", description: initial?.description ?? "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try { await onSave(f); } catch (err) { setError((err as Error).message); }
      }}>
        {error && <div className="alert">{error}</div>}
        <label className="field"><span className="label">Nome</span><input className="input" required autoFocus value={f.name} onChange={set("name")} placeholder="Ex.: Condomínio La Paloma ou Casa 12" /></label>
        <label className="field"><span className="label">Cliente</span><input className="input" value={f.client_name} onChange={set("client_name")} /></label>
        <label className="field"><span className="label">Endereço ou número</span><input className="input" value={f.address} onChange={set("address")} placeholder="Ex.: Rua das Flores, 120" /></label>
        <label className="field"><span className="label">Observações</span><input className="input" value={f.description} onChange={set("description")} /></label>
        <button className="btn btn-primary">Salvar</button>
      </form>
    </Modal>
  );
}
