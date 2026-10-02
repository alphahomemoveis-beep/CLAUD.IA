"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { Modal } from "../Modal";
import { MediaPicker } from "./MediaPicker";
import { TYPE_LABEL, type Post } from "./PostCard";

const NETWORK_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn" };

function tomorrowAt(h: number) {
  const d = new Date(Date.now() + 86400_000);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(h)}:00`;
}

/** Post feito à mão, sem IA. Nasce como rascunho, igual aos da IA. */
export function NewPost({ initialMedia, onClose, onCreated }: {
  initialMedia: Array<{ id: string; label: string }>; onClose: () => void; onCreated: (p: Post) => void;
}) {
  const [media, setMedia] = useState(initialMedia);
  const [picking, setPicking] = useState(initialMedia.length === 0);
  const [f, setF] = useState({ localDateTime: tomorrowAt(10), type: "REEL" as Post["post_type"], caption: "", hashtags: "#moveisplanejados #marcenaria #altopadrao", firstComment: "", networks: ["instagram"] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = f.caption.length + f.hashtags.length + 2;
  const toggle = (n: string) => setF({ ...f, networks: f.networks.includes(n) ? f.networks.filter((x) => x !== n) : [...f.networks, n] });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ post: Post }>("/api/posts", { method: "POST", json: {
        mediaIds: media.map((m) => m.id), localDateTime: `${f.localDateTime}:00`, type: f.type, caption: f.caption,
        hashtags: f.hashtags.split(/\s+/).filter(Boolean), firstComment: f.firstComment, networks: f.networks,
      } });
      onCreated(res.post);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (picking) {
    return <MediaPicker initial={media.map((m) => m.id)} onClose={() => (media.length ? setPicking(false) : onClose())} onPick={(ids) => {
      setMedia(ids);
      setPicking(false);
      // Tipo sugerido pela mídia: 1 vídeo = Reels, 1 foto = Post, várias = Carrossel.
      const videos = ids.filter((m) => m.label.endsWith("vídeo")).length;
      const known = ids.every((m) => m.label.endsWith("vídeo") || m.label.endsWith("foto"));
      if (known && ids.length) setF((cur) => ({ ...cur, type: ids.length > 1 ? "CARROSSEL" : videos ? "REEL" : "POST" }));
    }} />;
  }

  return (
    <Modal title="Novo post" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {error && <div className="alert">{error}</div>}
        <div className="spread">
          <span className="small">{media.length} mídia(s) das pastas</span>
          <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>📎 Trocar mídias</button>
        </div>
        <div className="grid-2">
          <label className="field"><span className="label">Data e hora</span><input className="input" type="datetime-local" required value={f.localDateTime} onChange={(e) => setF({ ...f, localDateTime: e.target.value })} /></label>
          <label className="field"><span className="label">Tipo</span>
            <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Post["post_type"] })}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="hint">Reels: um vídeo. Post: uma foto. Carrossel: 2 a 10 mídias.</span>
          </label>
        </div>
        <div className="row small">{Object.entries(NETWORK_LABEL).map(([k, v]) => <label key={k} className="check"><input type="checkbox" checked={f.networks.includes(k)} onChange={() => toggle(k)} /> {v}</label>)}</div>
        <label className="field"><span className="label">Legenda</span><textarea className="textarea" style={{ minHeight: 130 }} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} placeholder="Escreva a legenda ou peça para o Claude no chat e cole aqui" /><span className="hint">{total} de 2200 caracteres com as hashtags</span></label>
        <label className="field"><span className="label">Hashtags</span><input className="input" value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} /></label>
        <label className="field"><span className="label">Primeiro comentário (opcional)</span><input className="input" value={f.firstComment} onChange={(e) => setF({ ...f, firstComment: e.target.value })} /></label>
        <button className="btn btn-primary" disabled={busy || !media.length}>{busy ? <span className="spinner" /> : "Criar rascunho"}</button>
        <span className="tiny muted">O post entra como rascunho. Um dono ou gerente confirma no calendário.</span>
      </form>
    </Modal>
  );
}
