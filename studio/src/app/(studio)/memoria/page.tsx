"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/client";

interface Pref {
  id: string; kind: string; rule: string; scope: string; source: string; active: boolean; created_at: string;
  project_title: string | null; feedback_comment: string | null; feedback_kind: string | null;
}
interface Mem { memory: string; prompts: Array<{ title: string; version: number }>; preferences: number; references: { aprovadas: number; favoritas: number; avaliacao: number } }

const KIND: Record<string, { label: string; tone: string }> = {
  preferir: { label: "Preferir", tone: "chip-ok" }, evitar: { label: "Evitar", tone: "chip-bad" }, regra: { label: "Regra", tone: "chip-info" },
};

export default function MemoryPage() {
  const [mem, setMem] = useState<Mem | null>(null);
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [kind, setKind] = useState("evitar");
  const [rule, setRule] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => Promise.all([
    api<Mem>("/api/memory").then(setMem),
    api<{ preferences: Pref[] }>("/api/preferences").then((d) => setPrefs(d.preferences)),
  ]).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/preferences", { method: "POST", json: { kind, rule } });
      setRule("");
      load();
    } catch (err) { setError((err as Error).message); }
  }
  async function toggle(p: Pref) { await api(`/api/preferences/${p.id}`, { method: "PATCH", json: { active: !p.active } }); load(); }
  async function promote(p: Pref) { await api(`/api/preferences/${p.id}`, { method: "PATCH", json: { scope: "marca" } }); load(); }
  async function remove(p: Pref) {
    if (!window.confirm(`Apagar a preferência "${p.rule}"?`)) return;
    await api(`/api/preferences/${p.id}?confirmar=sim`, { method: "DELETE" });
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">🧠 Memória da marca</div>
          <h1>O que todo chat novo já sabe</h1>
          <p className="lead">Um chat novo começa sem a conversa anterior, mas recebe sempre o Prompt Mestre ativo, a identidade, as referências aprovadas, as preferências aprendidas, as regras e o checklist de qualidade.</p>
        </div>
      </div>
      {error && <div className="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {mem && (
        <div className="grid-4" style={{ marginBottom: 20 }}>
          <div className="stat"><div className="n">{mem.prompts.length}</div><div className="l">Prompts Mestre ativos</div><div className="tiny muted" style={{ marginTop: 6 }}>{mem.prompts.map((p) => `${p.title} v${p.version}`).join(", ") || "nenhum"}</div></div>
          <div className="stat"><div className="n">{mem.references.aprovadas}</div><div className="l">Referências aprovadas</div><div className="tiny muted" style={{ marginTop: 6 }}>{mem.references.favoritas} favoritas · {mem.references.avaliacao} em avaliação</div></div>
          <div className="stat"><div className="n">{mem.preferences}</div><div className="l">Preferências ativas</div></div>
          <div className="stat"><div className="n">10</div><div className="l">Itens do checklist</div></div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="spread">
          <div><h3>Contexto completo</h3><div className="small muted">Texto exato enviado à IA no início de cada etapa. As referências são buscadas por pedido.</div></div>
          <div className="row"><Link className="btn btn-sm" href="/configuracoes">Editar Prompt Mestre</Link><button className="btn btn-sm" onClick={() => setShowFull(!showFull)}>{showFull ? "Esconder" : "Ver contexto"}</button></div>
        </div>
        {showFull && mem && <div className="pre mono card-flat" style={{ marginTop: 14, maxHeight: 520, overflowY: "auto" }}>{mem.memory}</div>}
      </div>

      <div className="section-title"><h2>Preferências aprendidas</h2></div>
      <form className="row card-flat" style={{ marginBottom: 14 }} onSubmit={add}>
        <select className="select" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
          <option value="evitar">Evitar</option><option value="preferir">Preferir</option><option value="regra">Regra</option>
        </select>
        <input className="input" style={{ flex: 1, minWidth: 220 }} value={rule} onChange={(e) => setRule(e.target.value)} placeholder="Ex.: Nunca usar mais de 8 palavras numa arte" />
        <button className="btn btn-primary" disabled={rule.trim().length < 3}>Adicionar</button>
      </form>
      {!prefs && <span className="spinner" />}
      {prefs && prefs.length === 0 && <div className="empty">Ainda não há preferências. Elas nascem do seu feedback nas criações (👎 e ✏️) ou podem ser adicionadas aqui.</div>}
      {prefs && prefs.length > 0 && (
        <div className="list">
          {prefs.map((p) => (
            <div key={p.id} className="list-item" style={{ opacity: p.active ? 1 : 0.55 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`chip ${KIND[p.kind]?.tone}`}>{KIND[p.kind]?.label}</span>
                  <span>{p.rule}</span>
                </div>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {p.scope === "projeto" ? `Só no projeto ${p.project_title ?? ""}` : "Toda a marca"} · {p.source === "feedback" ? `aprendida do feedback${p.feedback_comment ? `: “${p.feedback_comment}”` : ""}` : "manual"} · {fmtDate(p.created_at)}
                </div>
              </div>
              <div className="row" style={{ flexShrink: 0 }}>
                {p.scope === "projeto" && <button className="btn btn-ghost btn-xs" onClick={() => promote(p)}>Levar para a marca</button>}
                <button className="btn btn-ghost btn-xs" onClick={() => toggle(p)}>{p.active ? "Desativar" : "Ativar"}</button>
                <button className="btn btn-ghost btn-xs btn-danger" onClick={() => remove(p)}>Apagar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
