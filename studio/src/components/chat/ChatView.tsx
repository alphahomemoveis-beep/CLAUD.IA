"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, pad } from "@/lib/client";
import { STAGE_LABEL, STAGE_ORDER, TYPE_LABEL } from "@/lib/labels";
import { Toast } from "../Modal";
import { BriefingCard, ConceptsCard, PlanCard, QualityCard, ReferencesCard, ResearchCard } from "./Cards";
import { ImageTile } from "./ImageTile";
import type { Action, ChatImage, ChatMessage, ChatProject, PlanStatus } from "./types";

interface Loaded {
  messages: ChatMessage[];
  project: ChatProject | null;
  images: ChatImage[];
  plans: PlanStatus[];
  imageMode?: string;
}

const EXAMPLES = [
  "Crie um carrossel sobre móveis que facilitam o dia a dia.",
  "Crie um Reels sobre cozinhas pequenas.",
  "Quero uma arte sobre organização.",
  "Crie uma imagem mostrando um closet planejado.",
];

function stepsFor(action: Action, hasProject: boolean): string[] {
  switch (action.type) {
    case "message":
      return hasProject ? ["Lendo sua resposta", "Preparando a próxima etapa"] : [
        "Analisando o pedido", "Pesquisando o mercado", "Consultando referências AlphaHome", "Criando conceitos",
      ];
    case "choose_concept": return ["Lendo o conceito escolhido", "Recuperando referências", "Montando o planejamento completo"];
    case "approve_plan": return ["Escrevendo o prompt final", "Rodando o checklist de qualidade", "Preparando as peças"];
    case "revise_plan": return ["Lendo o pedido de alteração", "Revisando o planejamento"];
    case "regenerate_concepts": return ["Consultando referências", "Criando novos conceitos"];
  }
}

export function ChatView({ initialId }: { initialId?: string }) {
  const [conversationId, setConversationId] = useState<string | undefined>(initialId);
  const [data, setData] = useState<Loaded>({ messages: [], project: null, images: [], plans: [] });
  const [loading, setLoading] = useState(!!initialId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<{ steps: string[]; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [memory, setMemory] = useState<{ prompts: Array<{ title: string; version: number }>; preferences: number; references: { aprovadas: number } } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const generating = useRef(new Set<string>());

  const load = useCallback(async (id: string) => {
    const res = await api<Loaded>(`/api/conversations/${id}`);
    setData(res);
    return res;
  }, []);

  useEffect(() => {
    if (initialId) {
      load(initialId).catch((e) => setError(e.message)).finally(() => setLoading(false));
    } else {
      api<typeof memory>("/api/memory").then(setMemory).catch(() => undefined);
    }
  }, [initialId, load]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [data.messages.length, busy]);

  // Avança as etapas do indicador enquanto a IA trabalha.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setBusy((b) => (b && b.at < b.steps.length - 1 ? { ...b, at: b.at + 1 } : b)), 7000);
    return () => clearInterval(t);
  }, [busy?.steps]); // eslint-disable-line react-hooks/exhaustive-deps

  const setImage = useCallback((img: ChatImage) => {
    setData((d) => ({ ...d, images: d.images.some((i) => i.id === img.id) ? d.images.map((i) => (i.id === img.id ? { ...i, ...img } : i)) : [...d.images, img] }));
  }, []);

  /** Gera as peças uma a uma: cada slide é uma imagem independente. */
  const generate = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      if (generating.current.has(id)) continue;
      generating.current.add(id);
      setData((d) => ({ ...d, images: d.images.map((i) => (i.id === id ? { ...i, status: "gerando" } : i)) }));
      try {
        const res = await api<{ image: ChatImage }>(`/api/images/${id}/generate`, { method: "POST" });
        setImage(res.image);
      } catch (err) {
        setData((d) => ({ ...d, images: d.images.map((i) => (i.id === id ? { ...i, status: "falhou", error: (err as Error).message } : i)) }));
      } finally {
        generating.current.delete(id);
      }
    }
    if (conversationId) load(conversationId).catch(() => undefined);
  }, [conversationId, load, setImage]);

  // Continua gerações pendentes ao abrir a conversa.
  useEffect(() => {
    if (!data.project || !["aprovado", "gerado"].includes(data.project.stage) || data.imageMode === "manual") return;
    const pending = data.images.filter((i) => i.status === "pendente").map((i) => i.id);
    if (pending.length && !busy) generate(pending);
  }, [data.project?.stage, data.images.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: Action) {
    setError(null);
    setBusy({ steps: stepsFor(action, !!data.project), at: 0 });
    let id = conversationId;
    try {
      if (!id) {
        const res = await api<{ conversation: { id: string } }>("/api/conversations", { method: "POST" });
        id = res.conversation.id;
        setConversationId(id);
        window.history.replaceState(null, "", `/chat/${id}`);
      }
      if (action.type === "message") {
        setData((d) => ({ ...d, messages: [...d.messages, { id: "tmp", role: "user", kind: "text", content: action.text, payload: null, created_at: new Date().toISOString() }] }));
      }
      const res = await api<{ messages: ChatMessage[]; project: ChatProject | null; images: ChatImage[]; plans: PlanStatus[]; imageMode: string }>(
        `/api/conversations/${id}/actions`, { method: "POST", json: action });
      setData((d) => ({
        messages: [...d.messages.filter((m) => m.id !== "tmp"), ...res.messages],
        project: res.project, images: res.images, plans: res.plans, imageMode: res.imageMode,
      }));
      const toGenerate = res.imageMode === "manual" ? [] : res.messages.filter((m) => m.kind === "generation").flatMap((m) => (m.payload?.imageIds as string[]) ?? []);
      setBusy(null);
      window.dispatchEvent(new Event("alphahome:conversas"));
      if (toGenerate.length) generate(toGenerate);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
      if (id) load(id).catch(() => undefined);
    }
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    run({ type: "message", text: t });
  }

  const lastConcepts = useMemo(() => [...data.messages].reverse().find((m) => m.kind === "concepts")?.id, [data.messages]);
  const lastPlanId = data.plans[data.plans.length - 1]?.id;
  const stage = data.project?.stage;
  const tall = data.project?.content_type === "reels" || data.project?.content_type === "story";

  const composer = (
    <form className="composer" onSubmit={submit}>
      <textarea
        rows={1}
        value={text}
        placeholder={data.project ? "Responda, escolha um conceito ou peça uma alteração…" : "O que você quer criar?"}
        onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        aria-label="Mensagem"
      />
      <button className="btn btn-primary" type="submit" disabled={!text.trim() || !!busy}>{busy ? <span className="spinner" /> : "Enviar"}</button>
    </form>
  );

  if (loading) return <div className="studio"><div className="hero"><span className="spinner" /></div></div>;

  if (!data.messages.length && !busy) {
    return (
      <div className="studio">
        <div className="hero">
          <div className="ask">O que você quer criar?</div>
          <h1>Direção criativa <em>AlphaHome</em></h1>
          <p className="lead" style={{ margin: "12px auto 0" }}>
            Descreva a ideia. O estúdio entende a marca, pesquisa, consulta as referências e propõe conceitos. Você escolhe e aprova. Só então a IA executa.
          </p>
          {error && <div className="alert" style={{ marginTop: 16 }}>{error}</div>}
          {composer}
          <div className="examples">
            {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => setText(e)}>{e}</button>)}
          </div>
          {memory && (
            <div className="memory-note">
              <span>🧠 Este chat já sabe:</span>
              <span>{memory.prompts.length ? memory.prompts.map((p) => `${p.title} v${p.version}`).join(", ") : "nenhum Prompt Mestre ativo"}</span>
              <span>· {memory.references.aprovadas} referências aprovadas</span>
              <span>· {memory.preferences} preferências aprendidas</span>
              <Link href="/memoria">ver memória</Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="studio">
      <div className="studio-head">
        <div>
          <div className="title">{data.project?.title ?? "Nova conversa"}</div>
          {data.project && (
            <div className="tiny muted">
              {TYPE_LABEL[data.project.content_type]} · v{pad(data.project.current_version)} · <Link href={`/projetos/${data.project.id}`}>abrir projeto</Link>
            </div>
          )}
        </div>
        {stage && (
          <div className="flow" aria-label="Etapas">
            {STAGE_ORDER.map((s) => {
              const idx = STAGE_ORDER.indexOf(stage);
              const i = STAGE_ORDER.indexOf(s);
              return <span key={s} className={i < idx ? "done" : i === idx ? "now" : ""}>{STAGE_LABEL[s]}</span>;
            })}
          </div>
        )}
      </div>

      <div className="thread" ref={threadRef}>
        <div className="thread-inner">
          {data.messages.map((m) => {
            if (m.role === "user") return <div key={m.id} className="msg-user">{m.content}</div>;
            return (
              <div key={m.id} className="msg-ai">
                {m.kind === "text" && <div className="msg-text">{m.content}</div>}
                {m.kind === "briefing" && <BriefingCard msg={m} />}
                {m.kind === "research" && <ResearchCard msg={m} />}
                {m.kind === "references" && <ReferencesCard msg={m} />}
                {m.kind === "concepts" && (
                  <ConceptsCard
                    msg={m}
                    active={m.id === lastConcepts && (stage === "conceitos" || stage === "planejamento")}
                    chosenId={data.project?.chosen_concept_id ?? null}
                    busy={!!busy}
                    onChoose={(conceptId) => run({ type: "choose_concept", conceptId })}
                    onRegenerate={(notes) => run({ type: "regenerate_concepts", notes })}
                  />
                )}
                {m.kind === "plan" && (
                  <PlanCard
                    msg={m}
                    active={m.payload?.planId === lastPlanId && stage === "planejamento"}
                    approved={!!data.plans.find((p) => p.id === m.payload?.planId)?.approved}
                    busy={!!busy}
                    onApprove={(planId) => run({ type: "approve_plan", planId })}
                    onRevise={(notes) => run({ type: "revise_plan", notes })}
                  />
                )}
                {m.kind === "quality" && <QualityCard msg={m} />}
                {m.kind === "generation" && (
                  <div className="stack">
                    <div className="small muted">{m.content}</div>
                    <div className="images">
                      {((m.payload?.imageIds as string[]) ?? []).map((id) => {
                        const img = data.images.find((i) => i.id === id);
                        if (!img) return null;
                        return (
                          <ImageTile
                            key={id}
                            image={img}
                            tall={tall}
                            manual={data.imageMode === "manual"}
                            canGenerate={stage === "aprovado" || stage === "gerado"}
                            onGenerate={(gid) => generate([gid])}
                            onNotice={setToast}
                            onUpdated={(updated, extra) => {
                              setImage({ ...img, ...updated });
                              if (extra?.lessons?.length) setToast(`Aprendizado guardado: ${extra.lessons.map((l) => l.rule).join(" · ")}`);
                              if (extra?.revision && conversationId) load(conversationId).then((d) => { if (d.imageMode !== "manual") generate([extra.revision!.id]); });
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {busy && (
            <div className="working" aria-live="polite">
              {busy.steps.map((s, i) => (
                <div key={s} className={`step ${i < busy.at ? "done" : i === busy.at ? "now" : ""}`}><span className="dot" />{s}</div>
              ))}
            </div>
          )}
          {error && <div className="alert" role="alert">{error}</div>}
        </div>
      </div>

      <div className="composer-wrap">{composer}</div>
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
