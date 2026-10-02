"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

interface Identity {
  atributos?: string; tom_de_voz?: string; publico?: string; instagram?: string; logo_regras?: string;
  assinatura_regras?: string; assinatura_fantasma?: boolean; assinatura_fantasma_texto?: string; cores_marca?: string[]; evitar?: string;
}
interface Brand { name: string; positioning: string; identity: Identity; has_logo: boolean; updated_at: string }

export default function IdentityPage() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [id, setId] = useState<Identity>({});
  const [colors, setColors] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [logoV, setLogoV] = useState(0);

  useEffect(() => {
    api<{ brand: Brand }>("/api/brand").then((d) => {
      setBrand(d.brand); setId(d.brand.identity ?? {}); setColors((d.brand.identity?.cores_marca ?? []).join(", "));
    }).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);

  const set = (k: keyof Identity) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setId({ ...id, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const d = await api<{ brand: Brand }>("/api/brand", { method: "PUT", json: { identity: { ...id, cores_marca: colors.split(",").map((c) => c.trim()).filter(Boolean) } } });
      setBrand(d.brand);
      setMsg({ ok: true, text: "Identidade salva. Vale a partir da próxima mensagem em qualquer chat." });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }

  async function uploadLogo(file: File) {
    const form = new FormData();
    form.set("file", file);
    try {
      await api("/api/brand/logo", { method: "POST", body: form });
      setBrand((b) => (b ? { ...b, has_logo: true } : b));
      setLogoV(Date.now());
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }

  if (!brand) return <div className="page">{msg ? <div className="alert">{msg.text}</div> : <span className="spinner" />}</div>;
  const ghostText = id.assinatura_fantasma_texto || brand.name;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">🎨 Identidade</div>
          <h1>{brand.name} · {brand.positioning}</h1>
          <p className="lead">A identidade entra em toda criação. Nome, posicionamento e Prompt Mestre ficam em ⚙️ Configurações.</p>
        </div>
      </div>
      {msg && <div className={`alert ${msg.ok ? "alert-ok" : ""}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <form onSubmit={save} className="grid-2" style={{ alignItems: "start" }}>
        <div className="card stack">
          <h3>Essência</h3>
          <label className="field"><span className="label">A identidade deve transmitir</span><input className="input" value={id.atributos ?? ""} onChange={set("atributos")} placeholder="sofisticação + arquitetura + funcionalidade + exclusividade + desejo" /></label>
          <label className="field"><span className="label">Tom de voz</span><textarea className="textarea" value={id.tom_de_voz ?? ""} onChange={set("tom_de_voz")} /></label>
          <label className="field"><span className="label">Público</span><textarea className="textarea" value={id.publico ?? ""} onChange={set("publico")} /></label>
          <label className="field"><span className="label">Instagram</span><input className="input" value={id.instagram ?? ""} onChange={set("instagram")} /></label>
          <label className="field"><span className="label">Cores e materiais da marca</span><input className="input" value={colors} onChange={(e) => setColors(e.target.value)} placeholder="Freijó, Fendi, Pedra clara" /><span className="hint">Separe por vírgula.</span></label>
          <label className="field"><span className="label">Evitar sempre</span><textarea className="textarea" value={id.evitar ?? ""} onChange={set("evitar")} /></label>
        </div>

        <div className="stack">
          <div className="card stack">
            <h3>Logo</h3>
            <div className="card-flat" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 120 }}>
              {brand.has_logo ? <img src={`/api/brand/logo?v=${logoV}`} alt="Logo" style={{ maxHeight: 100 }} /> : <span className="muted small">Nenhuma logo enviada</span>}
            </div>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
            <label className="field"><span className="label">Como a logo aparece</span><textarea className="textarea" value={id.logo_regras ?? ""} onChange={set("logo_regras")} /></label>
          </div>
          <div className="card stack">
            <h3>Assinatura</h3>
            <div className="signature-preview">{brand.name}</div>
            <label className="field"><span className="label">Regras da assinatura</span><input className="input" value={id.assinatura_regras ?? ""} onChange={set("assinatura_regras")} placeholder="cursiva + manuscrita + fina + sofisticada" /></label>
            <label className="check"><input type="checkbox" checked={!!id.assinatura_fantasma} onChange={(e) => setId({ ...id, assinatura_fantasma: e.target.checked })} /> Permitir assinatura fantasma transparente integrada ao cenário</label>
            {id.assinatura_fantasma && (
              <>
                <label className="field"><span className="label">Texto da assinatura fantasma</span><input className="input" value={id.assinatura_fantasma_texto ?? ""} onChange={set("assinatura_fantasma_texto")} placeholder={brand.name} /></label>
                <div className="ghost-preview"><span>{ghostText}</span></div>
              </>
            )}
          </div>
          <button className="btn btn-primary" type="submit">Salvar identidade</button>
        </div>
      </form>
    </div>
  );
}
