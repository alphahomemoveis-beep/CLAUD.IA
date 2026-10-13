"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { FORMAT_INFO, FORMATS, type Format } from "@/lib/criar/formats";

const ICON: Record<Format, string> = { reels: "🎬", feed: "🖼️", story: "📱", roteiro: "📝", carrossel: "🗂️" };
export const STATUS_LABEL: Record<string, string> = {
  pesquisando: "IA pesquisando", opcoes: "Esperando sua escolha", escolhida: "Escolhida: falta gerar", renderizando: "Montando",
  pronto: "Pronto", falhou: "Deu erro",
};

interface Item { id: string; format: Format; theme: string; status: string; titulo: string | null; created_at: string }

export function CriarHome({ canAct }: { canAct: boolean }) {
  const router = useRouter();
  const [format, setFormat] = useState<Format>("reels");
  const [tema, setTema] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ creations: Item[]; aiEnabled: boolean } | null>(null);
  const [insp, setInsp] = useState<{ file: File | null; url: string; tema: string }>({ file: null, url: "", tema: "" });

  async function startInspiration(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      if (insp.file) fd.append("file", insp.file);
      else fd.append("url", insp.url);
      fd.append("tema", insp.tema);
      const r = await api<{ id: string }>("/api/criar/inspiracao", { method: "POST", body: fd });
      router.push(`/criar/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  useEffect(() => { api<{ creations: Item[]; aiEnabled: boolean }>("/api/criar").then(setData).catch((e) => setError(e.message)); }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/criar", { method: "POST", json: { format, tema } });
      router.push(`/criar/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Criar conteúdo</div>
          <h1>O que vamos criar hoje?</h1>
          <p className="lead">A IA pesquisa o que está viralizando no Instagram e traz 3 opções. Você escolhe, ou pede outras, e o app monta.</p>
        </div>
      </div>

      {data && !data.aiEnabled && (
        <div className="alert alert-warn" style={{ marginBottom: 18 }}>
          A IA do app está desligada. Para ligar de graça, crie uma chave no Google AI Studio e cadastre <code>GEMINI_API_KEY</code> na Railway.
          Enquanto isso, peça as opções ao Claude no chat.
        </div>
      )}

      <form className="stack" onSubmit={start}>
        <div className="format-grid" role="radiogroup" aria-label="Formato">
          {FORMATS.map((f) => (
            <button type="button" key={f} role="radio" aria-checked={format === f} className={`format-card ${format === f ? "on" : ""}`} onClick={() => setFormat(f)}>
              <span className="ico" aria-hidden>{ICON[f]}</span>
              <strong>{FORMAT_INFO[f].label}</strong>
              <span className="tiny muted">{FORMAT_INFO[f].desc}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span className="label">Tema ou ideia (opcional)</span>
          <textarea className="textarea" value={tema} onChange={(e) => setTema(e.target.value)} maxLength={600}
            placeholder="Ex.: cozinha da Casa 12 do La Paloma, detalhes de iluminação, closet de casal… Deixe vazio para a IA escolher pelo que está em alta." />
        </label>
        {error && <div className="alert">{error}</div>}
        <div className="row">
          <button className="btn btn-primary" disabled={!canAct || busy || (data !== null && !data.aiEnabled)}>
            {busy ? <span className="spinner" /> : "🔎 Pesquisar e criar 3 opções"}
          </button>
          {!canAct && <span className="small muted">Só donos e gerentes criam conteúdo.</span>}
        </div>
      </form>

      <form className="card card-flat stack" style={{ marginTop: 28 }} onSubmit={startInspiration}>
        <div>
          <strong>🎞️ Igual a um vídeo de inspiração</strong>
          <div className="small muted">Mande um vídeo que você gostou. A IA mede os cortes, diz o que filmar em cada cena e o app monta no mesmo ritmo, com a cara da marca.</div>
        </div>
        <label className="btn btn-sm" style={{ alignSelf: "flex-start" }}>
          {insp.file ? `🎬 ${insp.file.name.slice(0, 28)}` : "📤 Enviar o vídeo"}
          <input type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(e) => setInsp({ ...insp, file: e.target.files?.[0] ?? null, url: "" })} />
        </label>
        <input className="input" value={insp.url} disabled={!!insp.file} onChange={(e) => setInsp({ ...insp, url: e.target.value })} placeholder="ou cole um link do YouTube" />
        <span className="tiny muted">Do Instagram ou do TikTok: salve o vídeo no celular (ou grave a tela) e envie o arquivo. Esses apps não deixam baixar pelo link.</span>
        <input className="input" value={insp.tema} maxLength={600} onChange={(e) => setInsp({ ...insp, tema: e.target.value })} placeholder="Sobre o que vai ser o vídeo da marca? (opcional)" />
        <div><button className="btn btn-primary" disabled={!canAct || busy || (!insp.file && !insp.url.trim()) || (data !== null && !data.aiEnabled)}>{busy ? <span className="spinner" /> : "Analisar e montar a receita"}</button></div>
      </form>

      <div className="section-title" style={{ marginTop: 36 }}>Criações recentes</div>
      {data?.creations.length === 0 && <div className="empty">Nada criado ainda.</div>}
      {!!data?.creations.length && (
        <div className="list">
          {data.creations.map((c) => (
            <Link key={c.id} href={`/criar/${c.id}`} className="list-item">
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong className="clip">{ICON[c.format]} {c.titulo ?? (c.theme || FORMAT_INFO[c.format].label)}</strong>
                <span className="tiny muted">{FORMAT_INFO[c.format].label} · {fmtDate(c.created_at)}</span>
              </div>
              <span className={`chip ${c.status === "pronto" ? "chip-ok" : c.status === "falhou" ? "chip-bad" : "chip-wood"}`}>{STATUS_LABEL[c.status]}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
