"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate, pad } from "@/lib/client";
import { PROJECT_STATUS, STAGE_LABEL, TYPE_LABEL } from "@/lib/labels";

interface Row {
  id: string; title: string; updated_at: string; last_message: string | null;
  project_id: string | null; content_type: string | null; stage: string | null; status: string | null; current_version: number | null;
}

export default function ConversationsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    api<{ conversations: Row[] }>(`/api/conversations${archived ? "?arquivadas=1" : ""}`).then((d) => setRows(d.conversations)).catch((e) => setError(e.message));
  }, [archived]);

  async function toggleArchive(id: string, value: boolean) {
    await api(`/api/conversations/${id}`, { method: "PATCH", json: { archived: value } });
    setRows((r) => r?.filter((x) => x.id !== id) ?? null);
  }

  const filtered = rows?.filter((r) => !q || r.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <div className="eyebrow">💬 Conversas</div>
          <h1>Conversas</h1>
          <p className="lead">Cada chat começa limpo, mas carrega a memória da marca. Os projetos ficam guardados com todo o histórico.</p>
        </div>
        <Link className="btn btn-primary" href={`/?novo=${Date.now()}`}>＋ Novo chat</Link>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Buscar conversa" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`chip ${!archived ? "on" : ""}`} onClick={() => setArchived(false)}>Ativas</button>
        <button className={`chip ${archived ? "on" : ""}`} onClick={() => setArchived(true)}>Arquivadas</button>
      </div>
      {error && <div className="alert">{error}</div>}
      {!rows && !error && <span className="spinner" />}
      {filtered && filtered.length === 0 && <div className="empty">Nenhuma conversa {archived ? "arquivada" : "ainda"}.</div>}
      {filtered && filtered.length > 0 && (
        <div className="list">
          {filtered.map((r) => (
            <div key={r.id} className="list-item">
              <Link href={`/chat/${r.id}`} style={{ textDecoration: "none", flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{r.title}</div>
                <div className="small muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.last_message ?? "Sem mensagens"}</div>
              </Link>
              <div className="row" style={{ flexShrink: 0 }}>
                {r.content_type && <span className="chip">{TYPE_LABEL[r.content_type]}</span>}
                {r.stage && <span className="chip chip-wood">{STAGE_LABEL[r.stage]}</span>}
                {r.status && <span className={`chip ${PROJECT_STATUS[r.status]?.tone}`}>{PROJECT_STATUS[r.status]?.icon} v{pad(r.current_version ?? 0)}</span>}
                <span className="tiny muted">{fmtDate(r.updated_at)}</span>
                <button className="btn btn-ghost btn-xs" onClick={() => toggleArchive(r.id, !archived)}>{archived ? "Restaurar" : "Arquivar"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
