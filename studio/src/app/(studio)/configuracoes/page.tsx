"use client";

import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/client";
import { Modal } from "@/components/Modal";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TABS = ["Configuração da marca", "Modelos de IA", "Usuários", "Atividades"] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Configuração da marca");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">⚙️ Configurações</div>
          <h1>Configurações</h1>
          <p className="lead">Configure a marca uma vez. Tudo o que estiver ativo aqui entra automaticamente em cada novo chat.</p>
        </div>
      </div>
      <div className="tabs">{TABS.map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "Configuração da marca" && <BrandTab />}
      {tab === "Modelos de IA" && <ModelsTab />}
      {tab === "Usuários" && <UsersTab />}
      {tab === "Atividades" && <ActivityTab />}
    </div>
  );
}

function useMsg() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const node = msg && <div className={`alert ${msg.ok ? "alert-ok" : ""}`} style={{ marginBottom: 14 }}>{msg.text}</div>;
  return { setMsg, node };
}

function BrandTab() {
  const [name, setName] = useState("");
  const [positioning, setPositioning] = useState("");
  const { setMsg, node } = useMsg();
  useEffect(() => { api<{ brand: any }>("/api/brand").then((d) => { setName(d.brand.name); setPositioning(d.brand.positioning); }); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/brand", { method: "PUT", json: { name, positioning } });
      setMsg({ ok: true, text: "Marca salva." });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <form className="card" onSubmit={save}>
        {node}
        <div className="grid-2">
          <label className="field"><span className="label">Nome</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span className="label">Posicionamento</span><input className="input" value={positioning} onChange={(e) => setPositioning(e.target.value)} /></label>
        </div>
        <div className="row" style={{ marginTop: 14 }}><button className="btn btn-primary">Salvar</button><span className="tiny muted">Logo, assinatura e atributos ficam em 🎨 Identidade.</span></div>
      </form>
      <MasterPrompts />
    </div>
  );
}

interface Version { id: string; version: number; content: string; notes: string; is_active: boolean; created_at: string; created_by_name: string | null }
interface MP { id: string; title: string; description: string; enabled: boolean; versions: Version[] }

function MasterPrompts() {
  const [prompts, setPrompts] = useState<MP[] | null>(null);
  const [creating, setCreating] = useState(false);
  const { setMsg, node } = useMsg();
  useEffect(() => { api<{ prompts: MP[] }>("/api/master-prompts").then((d) => setPrompts(d.prompts)).catch((e) => setMsg({ ok: false, text: e.message })); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function call(path: string, init: RequestInit & { json?: unknown }, ok?: string) {
    try {
      const d = await api<{ prompts: MP[] }>(path, init);
      setPrompts(d.prompts);
      if (ok) setMsg({ ok: true, text: ok });
      return true;
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
      return false;
    }
  }

  return (
    <div>
      <div className="section-title" style={{ marginTop: 0 }}>
        <div><h2>Prompt Mestre</h2><div className="small muted">Editar sempre cria uma nova versão. Versões anteriores só são apagadas com confirmação.</div></div>
        <button className="btn" onClick={() => setCreating(true)}>＋ Novo prompt</button>
      </div>
      {node}
      {!prompts && <span className="spinner" />}
      <div className="stack" style={{ gap: 18 }}>
        {prompts?.map((p) => <PromptEditor key={p.id} p={p} call={call} />)}
      </div>
      {creating && <NewPrompt onClose={() => setCreating(false)} onCreate={async (b) => { if (await call("/api/master-prompts", { method: "POST", json: b }, "Prompt criado.")) setCreating(false); }} />}
    </div>
  );
}

function PromptEditor({ p, call }: { p: MP; call: (path: string, init: RequestInit & { json?: unknown }, ok?: string) => Promise<boolean> }) {
  const active = p.versions.find((v) => v.is_active) ?? null;
  const latest = p.versions[0];
  const [content, setContent] = useState((active ?? latest)?.content ?? "");
  const [notes, setNotes] = useState("");
  const [activate, setActivate] = useState(true);
  const [viewing, setViewing] = useState<Version | null>(null);
  useEffect(() => { setContent((active ?? latest)?.content ?? ""); }, [active?.id, latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = content !== ((active ?? latest)?.content ?? "");

  async function saveVersion() {
    if (await call(`/api/master-prompts/${p.id}/versions`, { method: "POST", json: { content, notes, activate } }, "Nova versão salva.")) setNotes("");
  }
  async function removeVersion(v: Version) {
    const typed = window.prompt(`Para apagar a versão v${v.version} para sempre, digite v${v.version}:`);
    if (typed === null) return;
    await call(`/api/prompt-versions/${v.id}?confirmar=${encodeURIComponent(typed)}`, { method: "DELETE" }, `Versão v${v.version} apagada.`);
  }
  async function removePrompt() {
    const typed = window.prompt(`Isto apaga "${p.title}" e TODAS as ${p.versions.length} versões. Digite o título exato para confirmar:`);
    if (typed === null) return;
    await call(`/api/master-prompts/${p.id}?confirmar=${encodeURIComponent(typed)}`, { method: "DELETE" }, "Prompt apagado.");
  }

  return (
    <div className="card" style={{ opacity: p.enabled ? 1 : 0.75 }}>
      <div className="spread">
        <div>
          <h3>{p.title}</h3>
          <div className="small muted">{p.description}</div>
        </div>
        <div className="row">
          {active ? <span className="chip chip-ok">Ativa: v{active.version}</span> : <span className="chip chip-warn">Nenhuma versão ativa</span>}
          <label className="check small"><input type="checkbox" checked={p.enabled} onChange={(e) => call(`/api/master-prompts/${p.id}`, { method: "PATCH", json: { enabled: e.target.checked } })} /> Aplicar nas criações</label>
        </div>
      </div>
      <textarea className="textarea textarea-xl" style={{ marginTop: 14 }} value={content} onChange={(e) => setContent(e.target.value)} aria-label={`Conteúdo de ${p.title}`} />
      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Nota da versão (o que mudou)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <label className="check small"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Ativar ao salvar</label>
        <button className="btn btn-primary" disabled={!dirty || !content.trim()} onClick={saveVersion}>Salvar como nova versão</button>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary className="small" style={{ cursor: "pointer" }}>Histórico de versões ({p.versions.length})</summary>
        <div className="list" style={{ marginTop: 10 }}>
          {p.versions.map((v) => (
            <div key={v.id} className="list-item">
              <div>
                <strong>v{v.version}</strong> {v.is_active && <span className="chip chip-ok" style={{ marginLeft: 6 }}>ativa</span>}
                <div className="tiny muted">{fmtDate(v.created_at)}{v.created_by_name ? ` · ${v.created_by_name}` : ""}{v.notes ? ` · ${v.notes}` : ""}</div>
              </div>
              <div className="row">
                <button className="btn btn-ghost btn-xs" onClick={() => setViewing(v)}>Ver</button>
                <button className="btn btn-ghost btn-xs" onClick={() => setContent(v.content)}>Carregar no editor</button>
                {v.is_active
                  ? <button className="btn btn-ghost btn-xs" onClick={() => call(`/api/prompt-versions/${v.id}`, { method: "PATCH", json: { active: false } }, `v${v.version} desativada.`)}>Desativar</button>
                  : <button className="btn btn-ghost btn-xs" onClick={() => call(`/api/prompt-versions/${v.id}`, { method: "PATCH", json: { active: true } }, `v${v.version} ativada.`)}>Ativar</button>}
                {!v.is_active && p.versions.length > 1 && <button className="btn btn-ghost btn-xs btn-danger" onClick={() => removeVersion(v)}>Apagar</button>}
              </div>
            </div>
          ))}
        </div>
      </details>
      <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
        <button className="btn btn-sm" onClick={() => call(`/api/master-prompts/${p.id}/duplicate`, { method: "POST" }, "Prompt duplicado (desligado).")}>Duplicar</button>
        <button className="btn btn-sm btn-danger" onClick={removePrompt}>Apagar prompt</button>
      </div>
      {viewing && <Modal title={`${p.title} · v${viewing.version}`} onClose={() => setViewing(null)}><div className="pre mono card-flat">{viewing.content}</div></Modal>}
    </div>
  );
}

function NewPrompt({ onClose, onCreate }: { onClose: () => void; onCreate: (b: { title: string; description: string; content: string }) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  return (
    <Modal title="Novo Prompt Mestre" onClose={onClose}>
      <div className="stack">
        <label className="field"><span className="label">Título</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Regras de carrossel" /></label>
        <label className="field"><span className="label">Descrição</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <label className="field"><span className="label">Conteúdo</span><textarea className="textarea" style={{ minHeight: 220 }} value={content} onChange={(e) => setContent(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={!title.trim() || !content.trim()} onClick={() => onCreate({ title, description, content })}>Criar com versão v1 ativa</button>
      </div>
    </Modal>
  );
}

function ModelsTab() {
  const [s, setS] = useState<any>(null);
  const [eff, setEff] = useState<any>(null);
  const { setMsg, node } = useMsg();
  useEffect(() => { api<{ brand: any; effective: any }>("/api/brand").then((d) => { setS(d.brand.ai_settings ?? {}); setEff(d.effective); }); }, []);
  if (!s || !eff) return <span className="spinner" />;
  const set = (k: string, v: unknown) => setS({ ...s, [k]: v });

  async function save() {
    try {
      const d = await api<{ effective: any }>("/api/brand", { method: "PUT", json: { ai_settings: s } });
      setEff(d.effective);
      setMsg({ ok: true, text: "Configuração de IA salva." });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }

  return (
    <div className="card stack" style={{ maxWidth: 820 }}>
      {node}
      <div className="alert alert-info small">
        Provedor ativo: <strong>{eff.provider === "mock" ? "teste (sem custo, respostas simuladas)" : "OpenAI"}</strong>. A chave da API fica só no servidor, em variável de ambiente, e nunca chega ao navegador.
        Deixe um campo vazio para usar o padrão do servidor.
      </div>
      <div className="grid-2">
        <label className="field"><span className="label">Modelo de texto e planejamento</span><input className="input" value={s.text_model ?? ""} placeholder={eff.textModel} onChange={(e) => set("text_model", e.target.value)} /></label>
        <label className="field"><span className="label">Modelo de visão (análise de referências)</span><input className="input" value={s.vision_model ?? ""} placeholder={eff.visionModel} onChange={(e) => set("vision_model", e.target.value)} /></label>
        <label className="field"><span className="label">Modelo de imagem</span><input className="input" value={s.image_model ?? ""} placeholder={eff.imageModel} onChange={(e) => set("image_model", e.target.value)} /></label>
        <label className="field"><span className="label">Qualidade da imagem</span>
          <select className="select" value={s.image_quality ?? "high"} onChange={(e) => set("image_quality", e.target.value)}>
            {["low", "medium", "high", "xhigh", "max", "auto"].map((q) => <option key={q}>{q}</option>)}
          </select>
          <span className="hint">xhigh e max só existem nos modelos GPT Image 2.5.</span>
        </label>
        <label className="field"><span className="label">Conceitos por pedido</span>
          <select className="select" value={s.concept_count ?? 5} onChange={(e) => set("concept_count", Number(e.target.value))}>{[3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
        </label>
        <label className="field"><span className="label">Referências recuperadas por etapa</span>
          <input className="input" type="number" min={2} max={12} value={s.max_references ?? 6} onChange={(e) => set("max_references", Number(e.target.value))} />
        </label>
      </div>
      <label className="check"><input type="checkbox" checked={s.web_search ?? true} onChange={(e) => set("web_search", e.target.checked)} /> Pesquisar tendências na web antes de propor conceitos</label>
      <label className="check"><input type="checkbox" checked={!!s.use_reference_images} onChange={(e) => set("use_reference_images", e.target.checked)} /> Enviar as referências aprovadas do planejamento como imagens de entrada para o modelo de imagem</label>
      <div className="tiny muted">Embeddings: {eff.embeddingModel} (definido no servidor). Trocar de modelo de embeddings exige reanalisar as referências.</div>
      <div><button className="btn btn-primary" onClick={save}>Salvar</button></div>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<any[] | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "editor" });
  const { setMsg, node } = useMsg();
  const load = () => api<{ users: any[] }>("/api/users").then((d) => setUsers(d.users)).catch((e) => setMsg({ ok: false, text: e.message }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/users", { method: "POST", json: form });
      setForm({ name: "", email: "", password: "", role: "editor" });
      setMsg({ ok: true, text: "Usuário criado." });
      load();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }
  async function update(id: string, body: Record<string, unknown>) {
    try { await api(`/api/users/${id}`, { method: "PATCH", json: body }); load(); } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }

  return (
    <div className="stack">
      {node}
      {users && (
        <div className="list">
          {users.map((u) => (
            <div key={u.id} className="list-item">
              <div><strong>{u.name}</strong> <span className="small muted">{u.email}</span><div className="tiny muted">Último acesso: {u.last_login_at ? fmtDate(u.last_login_at) : "nunca"}</div></div>
              <div className="row">
                <select className="select" style={{ width: "auto" }} value={u.role} onChange={(e) => update(u.id, { role: e.target.value })}>
                  <option value="owner">Dono</option><option value="editor">Editor</option><option value="viewer">Leitura</option>
                </select>
                <button className="btn btn-ghost btn-xs" onClick={() => update(u.id, { disabled: !u.disabled })}>{u.disabled ? "Reativar" : "Desativar"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form className="card" onSubmit={create}>
        <h3 style={{ marginBottom: 12 }}>Novo usuário</h3>
        <div className="grid-2">
          <label className="field"><span className="label">Nome</span><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span className="label">E-mail</span><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field"><span className="label">Senha inicial</span><input className="input" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><span className="hint">Mínimo de 10 caracteres, com letras e números.</span></label>
          <label className="field"><span className="label">Papel</span>
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="editor">Editor</option><option value="viewer">Leitura</option><option value="owner">Dono</option></select>
          </label>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14 }}>Criar usuário</button>
      </form>
    </div>
  );
}

function ActivityTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ activity: any[] }>("/api/activity").then((d) => setRows(d.activity)).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="alert">{error}</div>;
  if (!rows) return <span className="spinner" />;
  return (
    <div className="list">
      {rows.length === 0 && <div className="empty">Sem atividades.</div>}
      {rows.map((r) => (
        <div key={r.id} className="list-item small">
          <div><strong>{r.action.replaceAll("_", " ")}</strong> <span className="muted">{r.entity ?? ""}</span></div>
          <span className="tiny muted">{r.user_name ?? "—"} · {r.ip ?? ""} · {fmtDate(r.created_at)}</span>
        </div>
      ))}
    </div>
  );
}
