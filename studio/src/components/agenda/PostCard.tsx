"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { Modal } from "../Modal";

export interface PostMedia { id: string; tipo: "image" | "video"; pasta: string; etapa: string; legenda: string }
export interface Post {
  id: string; post_type: "POST" | "CARROSSEL" | "REEL" | "STORY"; networks: string[]; caption: string; hashtags: string[];
  first_comment: string; media_ids: string[]; scheduled_at: string; timezone: string; local: string; when: string;
  status: "rascunho" | "agendado" | "publicado" | "falhou" | "cancelado"; pending_action: "cancelar" | null;
  delivery: "metricool" | "manual"; external_error: string | null; media: PostMedia[];
}

export const TYPE_LABEL = { POST: "Post", CARROSSEL: "Carrossel", REEL: "Reels", STORY: "Story" } as const;
const NETWORK_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn" };

function statusChip(p: Post) {
  if (p.pending_action === "cancelar") return <span className="chip chip-bad">Cancelamento aguardando confirmação</span>;
  switch (p.status) {
    case "rascunho": return <span className="chip chip-warn">🟡 Rascunho · aguardando confirmação</span>;
    case "agendado": return <span className="chip chip-ok">🟢 Agendado{p.delivery === "manual" ? " · publicação manual" : " · Metricool"}</span>;
    case "publicado": return <span className="chip chip-ok">✅ Publicado</span>;
    case "falhou": return <span className="chip chip-bad">❌ Falhou</span>;
    default: return <span className="chip">⚪ Cancelado</span>;
  }
}

interface Props { post: Post; canAct: boolean; onChange: (p: Post) => void; onNotice: (t: string) => void; compact?: boolean }

export function PostCard({ post, canAct, onChange, onNotice, compact }: Props) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const cover = post.media[0];

  async function act(path: string, ok: string) {
    setBusy(true);
    try {
      const res = await api<{ post: Post }>(`/api/posts/${post.id}/${path}`, { method: "POST" });
      onChange(res.post);
      onNotice(ok);
    } catch (err) {
      onNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const past = new Date(post.scheduled_at).getTime() < Date.now();

  return (
    <div className="card" style={{ padding: 14, opacity: post.status === "cancelado" ? 0.6 : 1 }}>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "72px 1fr" : "96px 1fr", gap: 14 }}>
        <div style={{ borderRadius: 10, overflow: "hidden", background: "var(--surface-3)", aspectRatio: post.post_type === "REEL" || post.post_type === "STORY" ? "9 / 16" : "4 / 5", position: "relative" }}>
          {cover && (cover.tipo === "video"
            ? <video src={`/api/folder-media/${cover.id}/file#t=0.5`} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <img src={`/api/folder-media/${cover.id}/file`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />)}
          {cover?.tipo === "video" && <span className="video-badge">▶ Vídeo</span>}
          {post.media.length > 1 && <span className="chip" style={{ position: "absolute", bottom: 4, right: 4, fontSize: 10 }}>+{post.media.length - 1}</span>}
        </div>
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{post.when.charAt(0).toUpperCase() + post.when.slice(1)}</div>
          <div className="row" style={{ gap: 4 }}>
            {statusChip(post)}
            <span className="chip">{TYPE_LABEL[post.post_type]}</span>
            {post.networks.map((n) => <span key={n} className="chip">{NETWORK_LABEL[n] ?? n}</span>)}
          </div>
          {cover && <div className="tiny muted">{cover.pasta} · {cover.etapa}</div>}
          <div className="small pre" style={{ maxHeight: compact ? 60 : 120, overflow: "hidden" }}>{post.caption}</div>
          {post.hashtags.length > 0 && <div className="tiny" style={{ color: "var(--info)" }}>{post.hashtags.join(" ")}</div>}
          {post.external_error && <div className="tiny" style={{ color: "var(--bad)" }}>{post.external_error}</div>}
          {canAct && post.status !== "cancelado" && post.status !== "publicado" && (
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {post.pending_action === "cancelar" && <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => act("confirm", "Post cancelado.")}>Confirmar cancelamento</button>}
              {!post.pending_action && (post.status === "rascunho" || post.status === "falhou") && (
                <button className="btn btn-sm btn-wood" disabled={busy} onClick={() => act("confirm", post.status === "falhou" ? "Tentando de novo." : "Post confirmado na agenda.")}>
                  {busy ? <span className="spinner" /> : post.status === "falhou" ? "Tentar de novo" : "Confirmar agendamento"}
                </button>
              )}
              <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}>Editar</button>
              {!post.pending_action && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act("cancel", post.status === "rascunho" ? "Rascunho descartado." : "Pedido de cancelamento criado. Confirme no cartão.")}>{post.status === "rascunho" ? "Descartar" : "Cancelar"}</button>}
              {post.status === "agendado" && post.delivery === "manual" && past && <button className="btn btn-sm" disabled={busy} onClick={() => act("published", "Marcado como publicado.")}>Marcar como publicado</button>}
            </div>
          )}
        </div>
      </div>
      {editing && <EditPost post={post} onClose={() => setEditing(false)} onSaved={(p) => { onChange(p); setEditing(false); onNotice(post.status === "agendado" ? "Alterado. O post voltou a rascunho: confirme de novo." : "Rascunho alterado."); }} />}
    </div>
  );
}

function EditPost({ post, onClose, onSaved }: { post: Post; onClose: () => void; onSaved: (p: Post) => void }) {
  const [f, setF] = useState({
    localDateTime: post.local.slice(0, 16), type: post.post_type, caption: post.caption, hashtags: post.hashtags.join(" "),
    firstComment: post.first_comment, networks: post.networks,
  });
  const [error, setError] = useState<string | null>(null);
  const total = f.caption.length + f.hashtags.length + 2;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await api<{ post: Post }>(`/api/posts/${post.id}`, { method: "PATCH", json: {
        localDateTime: `${f.localDateTime}:00`, type: f.type, caption: f.caption, hashtags: f.hashtags.split(/\s+/).filter(Boolean),
        firstComment: f.firstComment, networks: f.networks,
      } });
      onSaved(res.post);
    } catch (err) { setError((err as Error).message); }
  }
  const toggle = (n: string) => setF({ ...f, networks: f.networks.includes(n) ? f.networks.filter((x) => x !== n) : [...f.networks, n] });
  return (
    <Modal title="Editar post" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {error && <div className="alert">{error}</div>}
        {post.status === "agendado" && <div className="alert alert-warn small">Ao salvar, o post volta a rascunho e precisa ser confirmado de novo.</div>}
        <div className="grid-2">
          <label className="field"><span className="label">Data e hora ({post.timezone})</span><input className="input" type="datetime-local" required value={f.localDateTime} onChange={(e) => setF({ ...f, localDateTime: e.target.value })} /></label>
          <label className="field"><span className="label">Tipo</span>
            <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Post["post_type"] })}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <div className="row small">{Object.entries(NETWORK_LABEL).map(([k, v]) => <label key={k} className="check"><input type="checkbox" checked={f.networks.includes(k)} onChange={() => toggle(k)} /> {v}</label>)}</div>
        <label className="field"><span className="label">Legenda</span><textarea className="textarea" style={{ minHeight: 140 }} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} /><span className="hint">{total} de 2200 caracteres com as hashtags</span></label>
        <label className="field"><span className="label">Hashtags</span><input className="input" value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} /></label>
        <label className="field"><span className="label">Primeiro comentário (opcional)</span><input className="input" value={f.firstComment} onChange={(e) => setF({ ...f, firstComment: e.target.value })} /></label>
        <button className="btn btn-primary">Salvar</button>
      </form>
    </Modal>
  );
}
