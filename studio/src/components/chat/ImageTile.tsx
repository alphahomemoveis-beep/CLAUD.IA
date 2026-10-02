"use client";

import { useState } from "react";
import { api, pad } from "@/lib/client";
import { REJECT_EXAMPLES } from "@/lib/labels";
import { Modal } from "../Modal";
import type { ChatImage } from "./types";

interface Props {
  image: ChatImage;
  /** Sem gerador automático: copiar o prompt e enviar a imagem pronta. */
  manual?: boolean;
  tall: boolean;
  canGenerate: boolean;
  onGenerate: (id: string) => void;
  onUpdated: (image: ChatImage, extra?: { revision?: ChatImage | null; lessons?: Array<{ rule: string }> }) => void;
  onNotice: (text: string) => void;
  readOnly?: boolean;
}

export function ImageTile({ image, tall, canGenerate, onGenerate, onUpdated, onNotice, readOnly, manual }: Props) {
  const [dialog, setDialog] = useState<null | "rejeitar" | "alterar" | "prompt">(null);
  const [comment, setComment] = useState("");
  const [scope, setScope] = useState<"marca" | "projeto">("marca");
  const [learn, setLearn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);

  async function send(kind: "aprovar" | "rejeitar" | "favoritar" | "alterar", text = "") {
    setBusy(true);
    try {
      const res = await api<{ image: ChatImage; revision: ChatImage | null; lessons: Array<{ rule: string }> }>(
        `/api/images/${image.id}/feedback`, { method: "POST", json: { kind, comment: text, scope, learn } });
      onUpdated(res.image, { revision: res.revision, lessons: res.lessons });
      setDialog(null);
      setComment("");
    } catch (err) {
      onNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toLibrary() {
    setBusy(true);
    try {
      await api(`/api/images/${image.id}/to-library`, { method: "POST" });
      onNotice("Criação enviada para a Biblioteca visual como referência em avaliação.");
    } catch (err) {
      onNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadReady(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await api<{ image: ChatImage }>(`/api/images/${image.id}/upload`, { method: "POST", body: form });
      onUpdated(res.image);
    } catch (err) {
      onNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(image.prompt);
      onNotice("Prompt final copiado. Gere a imagem e envie a peça pronta aqui.");
    } catch {
      setDialog("prompt");
    }
  }

  const src = `/api/images/${image.id}/file?v=${image.generated_at ?? ""}`;

  return (
    <div className="tile">
      <div className={`frame ${tall ? "tall" : ""}`}>
        <span className="badge chip">{image.slide_role || "Peça"} {pad(image.slide_number)} · v{pad(image.version)}</span>
        {image.status === "pronta" && image.has_file && <img src={src} alt={`Peça ${image.slide_number}`} onClick={() => setZoom(true)} />}
        {image.status === "pendente" && !manual && (
          <div className="stack" style={{ alignItems: "center" }}>
            <span className="small muted">Aguardando geração</span>
            {canGenerate && !readOnly && <button className="btn btn-sm" onClick={() => onGenerate(image.id)}>Gerar agora</button>}
          </div>
        )}
        {image.status === "pendente" && manual && (
          <div className="stack" style={{ alignItems: "center", padding: 14, textAlign: "center" }}>
            <span className="small">Prompt final pronto e aprovado no checklist.</span>
            {canGenerate && !readOnly && (
              <>
                <button className="btn btn-sm btn-primary" onClick={copyPrompt}>Copiar prompt</button>
                <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                  {busy ? <span className="spinner" /> : "Enviar imagem pronta"}
                  <input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && uploadReady(e.target.files[0])} />
                </label>
              </>
            )}
          </div>
        )}
        {image.status === "gerando" && <div className="stack" style={{ alignItems: "center" }}><span className="spinner" /><span className="small muted">Gerando imagem…</span></div>}
        {image.status === "falhou" && (
          <div className="stack" style={{ alignItems: "center", padding: 14, textAlign: "center" }}>
            <span className="small" style={{ color: "var(--bad)" }}>A geração falhou.</span>
            <span className="tiny muted">{image.error}</span>
            {canGenerate && !readOnly && <button className="btn btn-sm" onClick={() => onGenerate(image.id)}>Tentar de novo</button>}
          </div>
        )}
      </div>
      <div className="meta">
        {image.quality_review?.resumo_da_mudanca && <div className="tiny muted">{image.quality_review.resumo_da_mudanca}</div>}
        {image.status === "pronta" && !readOnly && (
          <div className="fb">
            <button className={image.verdict === "aprovada" ? "on-ok" : ""} disabled={busy} onClick={() => send("aprovar")} title="Aprovar"><span>👍</span>Aprovar</button>
            <button className={image.verdict === "rejeitada" ? "on-bad" : ""} disabled={busy} onClick={() => setDialog("rejeitar")} title="Rejeitar"><span>👎</span>Rejeitar</button>
            <button className={image.favorite ? "on-fav" : ""} disabled={busy} onClick={() => send("favoritar")} title="Favoritar"><span>⭐</span>Favoritar</button>
            <button className={image.verdict === "alteracao" ? "on-edit" : ""} disabled={busy} onClick={() => setDialog("alterar")} title="Pedir alteração"><span>✏️</span>Alterar</button>
          </div>
        )}
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-ghost btn-xs" onClick={() => setDialog("prompt")}>Ver prompt</button>
          {image.status === "pronta" && <a className="btn btn-ghost btn-xs" href={`/api/images/${image.id}/file?baixar=1`}>Baixar</a>}
          {image.status === "pronta" && !readOnly && image.verdict === "aprovada" && <button className="btn btn-ghost btn-xs" disabled={busy} onClick={toLibrary}>Para a biblioteca</button>}
        </div>
      </div>

      {zoom && <div className="lightbox" onClick={() => setZoom(false)}><img src={src} alt="" /></div>}

      {dialog === "prompt" && (
        <Modal title={`Prompt final da peça ${pad(image.slide_number)}`} onClose={() => setDialog(null)}>
          <div className="pre mono card-flat">{image.prompt}</div>
          {image.model && <div className="tiny muted" style={{ marginTop: 8 }}>Modelo: {image.model} · {image.size}</div>}
        </Modal>
      )}

      {(dialog === "rejeitar" || dialog === "alterar") && (
        <Modal title={dialog === "rejeitar" ? "O que precisa mudar?" : "Pedir alteração"} onClose={() => setDialog(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {dialog === "rejeitar"
              ? "Opcional. O comentário vira uma preferência da marca e melhora as próximas criações."
              : "Descreva a mudança. Eu reescrevo o prompt desta peça dentro do planejamento aprovado e gero uma nova versão."}
          </p>
          <div className="row" style={{ gap: 6, marginBottom: 10 }}>
            {REJECT_EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => setComment((c) => (c ? `${c} ${e}` : e))}>{e}</button>)}
          </div>
          <textarea className="textarea" autoFocus value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ex.: Muito texto. Quero mais elegante." />
          <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
            <div className="stack" style={{ gap: 6 }}>
              <label className="check small"><input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} /> Guardar como aprendizado</label>
              {learn && (
                <div className="row small" style={{ gap: 12 }}>
                  <label className="check"><input type="radio" checked={scope === "marca"} onChange={() => setScope("marca")} /> Para a marca</label>
                  <label className="check"><input type="radio" checked={scope === "projeto"} onChange={() => setScope("projeto")} /> Só neste projeto</label>
                </div>
              )}
            </div>
            <button className="btn btn-primary" disabled={busy || (dialog === "alterar" && !comment.trim())} onClick={() => send(dialog, comment)}>
              {busy ? <span className="spinner" /> : dialog === "rejeitar" ? "Rejeitar" : "Criar nova versão"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
