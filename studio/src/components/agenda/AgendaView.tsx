"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Toast } from "../Modal";
import { MediaPicker } from "./MediaPicker";
import { PostCard, type Post } from "./PostCard";

interface Msg { id: string; role: "user" | "assistant"; kind: string; content: string; payload: { postIds?: string[]; attached?: string[] } | null }
interface Conv { id: string; title: string; updated_at: string }

const EXAMPLES = [
  "Coloca o vídeo do resultado da Casa 12 do La Paloma para sexta às 19h.",
  "Quais posts estão programados para esta semana?",
  "Agenda as fotos da obra da Casa 12 como carrossel para amanhã às 12h.",
];

function dayLabel(local: string) {
  const d = local.slice(0, 10);
  const today = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  const iso = (dt: Date) => `${dt.getFullYear()}-${z(dt.getMonth() + 1)}-${z(dt.getDate())}`;
  if (d === iso(today)) return "Hoje";
  const t = new Date(today); t.setDate(t.getDate() + 1);
  if (d === iso(t)) return "Amanhã";
  return new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}

export function AgendaView({ canAct, initialMedia }: { canAct: boolean; initialMedia: string | null }) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [delivery, setDelivery] = useState<"metricool" | "manual">("manual");
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<Array<{ id: string; label: string }>>(initialMedia ? [{ id: initialMedia, label: "mídia escolhida na pasta" }] : []);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"proximos" | "rascunhos" | "todos">("proximos");
  const [tab, setTab] = useState<"conversa" | "calendario">("conversa");
  const [toast, setToast] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const loadPosts = useCallback(async () => {
    const d = await api<{ posts: Post[]; delivery: "metricool" | "manual" }>("/api/posts");
    setPosts(d.posts);
    setDelivery(d.delivery);
  }, []);

  useEffect(() => {
    loadPosts().catch((e) => setToast(e.message));
    api<{ conversations: Conv[] }>("/api/agenda/conversations").then((d) => {
      setConvs(d.conversations);
      if (d.conversations[0] && !initialMedia) openConv(d.conversations[0].id);
    }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages.length, busy]);

  async function openConv(id: string) {
    setConvId(id);
    const d = await api<{ messages: Msg[] }>(`/api/agenda/conversations/${id}`);
    setMessages(d.messages);
    const ids = [...new Set(d.messages.flatMap((m) => m.payload?.postIds ?? []))];
    if (ids.length) {
      const extra = await api<{ posts: Post[] }>(`/api/posts?ids=${ids.join(",")}`);
      setPosts((p) => [...p.filter((x) => !ids.includes(x.id)), ...extra.posts]);
    }
  }

  function newConv() {
    setConvId(null);
    setMessages([]);
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setText("");
    const ids = attached.map((a) => a.id);
    setMessages((m) => [...m, { id: "tmp", role: "user", kind: "text", content: t, payload: null }]);
    try {
      let id = convId;
      if (!id) {
        id = (await api<{ conversation: { id: string } }>("/api/agenda/conversations", { method: "POST" })).conversation.id;
        setConvId(id);
      }
      const res = await api<{ messages: Msg[] }>(`/api/agenda/conversations/${id}/messages`, { method: "POST", json: { text: t, mediaIds: ids } });
      setMessages((m) => [...m.filter((x) => x.id !== "tmp"), ...res.messages]);
      setAttached([]);
      const touched = res.messages.flatMap((m) => m.payload?.postIds ?? []);
      await loadPosts();
      if (touched.length) {
        const extra = await api<{ posts: Post[] }>(`/api/posts?ids=${touched.join(",")}`);
        setPosts((p) => [...p.filter((x) => !touched.includes(x.id)), ...extra.posts].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
      }
      api<{ conversations: Conv[] }>("/api/agenda/conversations").then((d) => setConvs(d.conversations)).catch(() => undefined);
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== "tmp"));
      setText(t);
      setToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const updatePost = (p: Post) => setPosts((list) => list.map((x) => (x.id === p.id ? p : x)));

  const visible = useMemo(() => {
    const now = Date.now() - 3600_000;
    return posts
      .filter((p) => (filter === "todos" ? true : filter === "rascunhos" ? p.status === "rascunho" || p.pending_action || p.status === "falhou" : new Date(p.scheduled_at).getTime() >= now && p.status !== "cancelado"))
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  }, [posts, filter]);
  const groups = useMemo(() => {
    const g = new Map<string, Post[]>();
    for (const p of visible) {
      const k = p.local.slice(0, 10);
      g.set(k, [...(g.get(k) ?? []), p]);
    }
    return [...g.entries()];
  }, [visible]);
  const pendingCount = posts.filter((p) => p.status === "rascunho" || p.pending_action).length;

  const chat = (
    <div className="card" style={{ padding: 0, display: "flex", flexDirection: "column", height: "calc(100vh - 210px)", minHeight: 480 }}>
      <div className="spread" style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
        <select className="select" style={{ width: "auto", maxWidth: 260, minWidth: 0 }} value={convId ?? ""} onChange={(e) => (e.target.value ? openConv(e.target.value) : newConv())} aria-label="Conversa">
          <option value="">Nova conversa</option>
          {convs.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button className="btn btn-sm" onClick={newConv}>＋ Nova</button>
      </div>
      <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: 16 }} className="stack">
        {messages.length === 0 && (
          <div className="stack" style={{ alignItems: "flex-start" }}>
            <p className="muted" style={{ margin: 0 }}>Fale como falaria com alguém da equipe. Eu encontro a mídia nas pastas, escrevo a legenda e as hashtags e deixo o post pronto para um dono ou gerente confirmar.</p>
            {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => setText(e)}>{e}</button>)}
          </div>
        )}
        {messages.map((m) => m.role === "user"
          ? <div key={m.id} className="msg-user">{m.content.replace(/\n\n\[Mídias anexadas:.*\]$/s, "")}{m.payload?.attached?.length ? <div className="tiny" style={{ opacity: 0.7, marginTop: 4 }}>📎 {m.payload.attached.length} mídia(s)</div> : null}</div>
          : (
            <div key={m.id} className="stack" style={{ gap: 8 }}>
              <div className="msg-text" style={{ maxWidth: "100%" }}>{m.content}</div>
              {(m.payload?.postIds ?? []).map((id) => {
                const p = posts.find((x) => x.id === id);
                return p ? <PostCard key={id} post={p} canAct={canAct} compact onChange={updatePost} onNotice={setToast} /> : null;
              })}
            </div>
          ))}
        {busy && <div className="working"><div className="step now"><span className="dot" />Procurando a mídia, escrevendo a legenda e montando o rascunho…</div></div>}
      </div>
      <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
        {attached.length > 0 && (
          <div className="row" style={{ marginBottom: 8, gap: 6 }}>
            {attached.map((a) => <span key={a.id} className="chip chip-wood">📎 {a.label} <button className="btn-ghost" style={{ border: 0, background: "none", cursor: "pointer" }} aria-label="Remover" onClick={() => setAttached((x) => x.filter((y) => y.id !== a.id))}>✕</button></span>)}
          </div>
        )}
        <form className="composer" style={{ boxShadow: "none" }} onSubmit={send}>
          <button type="button" className="btn btn-ghost icon-btn" title="Anexar mídia das pastas" aria-label="Anexar mídia" onClick={() => setPicking(true)}>📎</button>
          <textarea rows={1} value={text} placeholder="Ex.: coloca o vídeo da Casa 12 para sexta às 19h" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Mensagem" />
          <button className="btn btn-primary" disabled={!text.trim() || busy || !canAct}>{busy ? <span className="spinner" /> : "Enviar"}</button>
        </form>
        {!canAct && <div className="tiny muted" style={{ marginTop: 6 }}>Seu acesso é só de leitura. Donos e gerentes agendam posts.</div>}
      </div>
    </div>
  );

  const calendar = (
    <div className="stack">
      <div className="spread">
        <div className="filters" style={{ margin: 0 }}>
          <button className={`chip ${filter === "proximos" ? "on" : ""}`} onClick={() => setFilter("proximos")}>Próximos</button>
          <button className={`chip ${filter === "rascunhos" ? "on" : ""}`} onClick={() => setFilter("rascunhos")}>Aguardando confirmação{pendingCount ? ` (${pendingCount})` : ""}</button>
          <button className={`chip ${filter === "todos" ? "on" : ""}`} onClick={() => setFilter("todos")}>Todos</button>
        </div>
      </div>
      <div className="alert alert-info small">
        {delivery === "metricool"
          ? "Posts confirmados vão para o Metricool e são publicados automaticamente na hora marcada."
          : "Metricool ainda não conectado: os posts confirmados ficam na agenda como lembrete e a equipe publica e marca como publicado."}
      </div>
      {groups.length === 0 && <div className="empty">Nenhum post neste filtro.</div>}
      {groups.map(([day, list]) => (
        <div key={day} className="stack" style={{ gap: 8 }}>
          <div className="eyebrow" style={{ textTransform: "uppercase" }}>{dayLabel(list[0].local)}</div>
          {list.map((p) => <PostCard key={p.id} post={p} canAct={canAct} onChange={updatePost} onNotice={setToast} />)}
        </div>
      ))}
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">📅 Agenda de posts</div>
          <h1>Agenda</h1>
          <p className="lead">Peça em português e a IA monta o post com legenda e hashtags. Nada é publicado sem a confirmação de um dono ou gerente.</p>
        </div>
      </div>
      <div className="tabs agenda-tabs">
        <button className={tab === "conversa" ? "on" : ""} onClick={() => setTab("conversa")}>💬 Conversa</button>
        <button className={tab === "calendario" ? "on" : ""} onClick={() => setTab("calendario")}>📅 Calendário{pendingCount ? ` (${pendingCount})` : ""}</button>
      </div>
      <div className="agenda-grid">
        <div className={tab === "conversa" ? "" : "agenda-hide"}>{chat}</div>
        <div className={tab === "calendario" ? "" : "agenda-hide"}>{calendar}</div>
      </div>
      {picking && <MediaPicker initial={attached.map((a) => a.id)} onClose={() => setPicking(false)} onPick={(ids) => { setAttached(ids); setPicking(false); }} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
