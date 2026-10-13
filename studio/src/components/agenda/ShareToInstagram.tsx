"use client";

import { useState } from "react";
import { Modal } from "../Modal";
import type { Post } from "./PostCard";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

/**
 * Publicação em um toque, sem Metricool: copia a legenda e abre o menu de
 * compartilhar do celular com as mídias, para escolher o Instagram. Onde o
 * navegador não compartilha arquivos (computador), baixa as mídias.
 */
export function ShareToInstagram({ post, onPublished }: { post: Post; onPublished: () => void }) {
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const caption = [post.caption, post.hashtags.join(" ")].filter(Boolean).join("\n\n");

  async function share() {
    setBusy(true);
    let copied = false;
    try {
      await navigator.clipboard.writeText(caption);
      copied = true;
    } catch { /* sem permissão de copiar: a legenda aparece no aviso */ }
    try {
      const files = await Promise.all(post.media.map(async (m, i) => {
        const res = await fetch(`/api/folder-media/${m.id}/file`, { credentials: "same-origin" });
        if (!res.ok) throw new Error("Não consegui carregar uma das mídias.");
        const blob = await res.blob();
        return new File([blob], `alphahome-${i + 1}.${EXT[blob.type] ?? "jpg"}`, { type: blob.type });
      }));
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files, text: caption });
        setAsked(copied ? "Legenda copiada: no Instagram, toque e segure na caixa da legenda e escolha Colar." : caption);
      } else {
        for (const [i, m] of post.media.entries()) {
          const a = document.createElement("a");
          a.href = `/api/folder-media/${m.id}/file?baixar=1`;
          a.download = files[i].name;
          a.click();
        }
        setAsked(copied ? "As mídias foram baixadas e a legenda foi copiada. Abra o Instagram, escolha as mídias e cole a legenda." : caption);
      }
    } catch (err) {
      // Fechar o menu de compartilhar sem escolher nada não é erro.
      if ((err as Error).name !== "AbortError") setAsked(`${(err as Error).message} A legenda: ${caption}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn-sm btn-wood" disabled={busy || !post.media.length} onClick={share}>
        {busy ? <span className="spinner" /> : "📲 Postar no Instagram"}
      </button>
      {asked && (
        <Modal title="Postou no Instagram?" onClose={() => setAsked(null)}>
          <div className="stack">
            <div className="small" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto" }}>{asked}</div>
            <div className="row">
              <button className="btn btn-primary" onClick={() => { setAsked(null); onPublished(); }}>✅ Sim, já postei</button>
              <button className="btn" onClick={() => setAsked(null)}>Ainda não</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
