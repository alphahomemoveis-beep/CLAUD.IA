"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate, pad } from "@/lib/client";
import { PROJECT_STATUS, STAGE_LABEL, TYPE_LABEL } from "@/lib/labels";

interface Row {
  id: string; title: string; content_type: string; stage: string; status: string; current_version: number;
  concept_title: string | null; cover_image_id: string | null; images: number; updated_at: string;
}

export default function ProjectsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    api<{ projects: Row[] }>(`/api/projects${status ? `?status=${status}` : ""}`).then((d) => setRows(d.projects)).catch((e) => setError(e.message));
  }, [status]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">📁 Projetos</div>
          <h1>Projetos</h1>
          <p className="lead">Briefing, conceitos, planejamento, prompts, imagens, versões, feedback e referências de cada criação.</p>
        </div>
      </div>
      <div className="filters">
        <button className={`chip ${!status ? "on" : ""}`} onClick={() => setStatus("")}>Todos</button>
        {Object.entries(PROJECT_STATUS).map(([k, v]) => (
          <button key={k} className={`chip ${status === k ? "on" : ""}`} onClick={() => setStatus(k)}>{v.icon} {v.label}</button>
        ))}
      </div>
      {error && <div className="alert">{error}</div>}
      {!rows && !error && <span className="spinner" />}
      {rows && rows.length === 0 && <div className="empty">Nenhum projeto aqui. Comece em ✨ Novo projeto.</div>}
      {rows && rows.length > 0 && (
        <div className="proj-grid">
          {rows.map((p) => (
            <Link key={p.id} href={`/projetos/${p.id}`} className="proj-card">
              <div className="cover">
                {p.cover_image_id ? <img src={`/api/images/${p.cover_image_id}/file`} alt="" loading="lazy" /> : <span className="ph">AlphaHome</span>}
              </div>
              <div className="body">
                <div className="spread">
                  <span className="chip">{TYPE_LABEL[p.content_type]}</span>
                  <span className="tiny muted">v{pad(p.current_version)}</span>
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 20, lineHeight: 1.2 }}>{p.title}</div>
                {p.concept_title && <div className="small muted">“{p.concept_title}”</div>}
                <div className="row">
                  <span className={`chip ${PROJECT_STATUS[p.status]?.tone}`}>{PROJECT_STATUS[p.status]?.icon} {PROJECT_STATUS[p.status]?.label}</span>
                  <span className="chip chip-wood">{STAGE_LABEL[p.stage]}</span>
                </div>
                <div className="tiny muted">{p.images} imagens · {fmtDate(p.updated_at)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
