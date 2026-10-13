"use client";

import { useEffect, useState } from "react";

/** Aviso na tela de entrada quando o banco não responde, com o que corrigir. */
export function DbStatus() {
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/saude", { cache: "no-store" }).then((r) => r.json()).then((d) => setErro(d.ok ? null : d.erro)).catch(() => undefined);
  }, []);
  if (!erro) return null;
  return <div className="alert" role="alert" style={{ marginBottom: 14 }}><strong>O app não conseguiu falar com o banco.</strong> {erro}</div>;
}
