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
