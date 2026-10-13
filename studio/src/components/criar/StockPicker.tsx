"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Modal } from "../Modal";

export interface StockItem { id: number; tipo: "foto" | "video"; thumb: string; autor: string; autor_url: string; pagina: string; duracao?: number }

/** Busca de fotos e vídeos gratuitos no Pexels, com o crédito de cada autor. */
export function StockPicker({ initialQuery, video, onClose, onPick }: { initialQuery: string; video: boolean; onClose: () => void; onPick: (it: StockItem) => void }) {
  const [q, setQ] = useState(initialQuery);
  const [tipo, setTipo] = useState<"foto" | "video">("foto");
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(query = q, t = tipo) {
    if (query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      setItems((await api<{ itens: StockItem[] }>(`/api/criar/fotos?q=${encodeURIComponent(query.trim())}&tipo=${t}`)).itens);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { search(initialQuery, "foto"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title="Buscar fundo no Pexels" onClose={onClose}>
      <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input className="input" style={{ flex: 1, minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Em inglês funciona melhor: walnut kitchen" aria-label="Busca" />
        <button className="btn">Buscar</button>
      </form>
      {video && (
        <div className="tabs" style={{ marginTop: 10 }}>
          {(["foto", "video"] as const).map((t) => <button key={t} className={`chip ${tipo === t ? "on" : ""}`} onClick={() => { setTipo(t); search(q, t); }}>{t === "foto" ? "Fotos" : "Vídeos"}</button>)}
        </div>
      )}
      {error && <div className="alert" style={{ marginTop: 10 }}>{error}</div>}
      {loading && <div style={{ marginTop: 12 }}><span className="spinner" /></div>}
      {items && !loading && (
        <div className="lib-grid" style={{ marginTop: 12, gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", maxHeight: 400, overflowY: "auto", gap: 10 }}>
          {items.length === 0 && <div className="empty">Nada encontrado. Tente outras palavras.</div>}
          {items.map((it) => (
            <button key={`${it.tipo}-${it.id}`} className="ref-card" onClick={() => onPick(it)} title={`${it.autor} no Pexels`}>
              <div className="thumb" style={{ aspectRatio: "9 / 14" }}>
                <img src={it.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                {it.tipo === "video" && <span className="video-badge">▶ {it.duracao}s</span>}
              </div>
              <div className="body"><div className="tiny clip">{it.autor}</div></div>
            </button>
          ))}
        </div>
      )}
      <div className="tiny muted" style={{ marginTop: 10 }}>
        Fotos e vídeos gratuitos do <a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a>. O crédito do autor fica salvo na criação.
      </div>
    </Modal>
  );
}
