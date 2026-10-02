"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal } from "../Modal";

interface Path { id: string; path: string; media: number }
interface M { id: string; stage: string; media_type: "image" | "video"; original_name: string; caption: string }

const STAGE_LABEL: Record<string, string> = { projeto: "📐 Projeto", obra: "🛠️ Obra", resultado: "✨ Resultado" };

/** Escolher fotos e vídeos das pastas para anexar ao pedido. */
export function MediaPicker({ initial, onClose, onPick }: { initial: string[]; onClose: () => void; onPick: (ids: Array<{ id: string; label: string }>) => void }) {
  const [paths, setPaths] = useState<Path[]>([]);
  const [folder, setFolder] = useState("");
  const [media, setMedia] = useState<M[]>([]);
  const [picked, setPicked] = useState<Array<{ id: string; label: string }>>(initial.map((id) => ({ id, label: "mídia" })));

  useEffect(() => { api<{ folders: Path[] }>("/api/folders/tree").then((d) => { setPaths(d.folders); const first = d.folders.find((p) => p.media > 0); if (first) setFolder(first.id); }); }, []);
  useEffect(() => { if (folder) api<{ media: M[] }>(`/api/folders/${folder}`).then((d) => setMedia(d.media)); }, [folder]);

  const label = (m: M) => `${paths.find((p) => p.id === folder)?.path ?? ""} · ${m.stage} · ${m.media_type === "video" ? "vídeo" : "foto"}`;
  const toggle = (m: M) => setPicked((p) => (p.some((x) => x.id === m.id) ? p.filter((x) => x.id !== m.id) : [...p, { id: m.id, label: label(m) }]));

  return (
    <Modal title="Anexar fotos e vídeos das pastas" onClose={onClose}>
      {paths.length === 0 && <div className="empty">Nenhuma pasta com mídias. Envie em 🗂️ Pastas.</div>}
      {paths.length > 0 && (
        <select className="select" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Pasta">
          {paths.map((p) => <option key={p.id} value={p.id}>{p.path} ({p.media})</option>)}
        </select>
      )}
      <div className="lib-grid" style={{ marginTop: 12, gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", maxHeight: 380, overflowY: "auto" }}>
        {media.map((m) => {
          const on = picked.some((x) => x.id === m.id);
          return (
            <button key={m.id} className="ref-card" style={{ borderColor: on ? "var(--wood-dark)" : undefined, boxShadow: on ? "0 0 0 2px var(--accent-soft)" : undefined }} onClick={() => toggle(m)}>
              <div className="thumb">
                {m.media_type === "video" ? <video src={`/api/folder-media/${m.id}/file#t=0.5`} muted preload="metadata" /> : <img src={`/api/folder-media/${m.id}/file`} alt="" loading="lazy" />}
                {on && <span className="fav">✓</span>}
              </div>
              <div className="body"><div className="tiny">{STAGE_LABEL[m.stage]}</div></div>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: "space-between" }}>
        <span className="small muted">{picked.length} selecionada(s)</span>
        <button className="btn btn-primary" onClick={() => onPick(picked)}>Anexar</button>
      </div>
    </Modal>
  );
}
