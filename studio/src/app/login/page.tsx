"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needed: boolean }>("/api/auth/setup").then((d) => { if (d.needed) window.location.href = "/primeiro-acesso"; }).catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password } });
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-art">
        <div>
          <div className="script">AlphaHome</div>
          <div className="eyebrow" style={{ color: "#b9ab99", marginTop: 10 }}>Creative Studio · Ambientes Planejados</div>
        </div>
        <blockquote>“Não é o ambiente que se adapta aos móveis, são os móveis que se adaptam ao cliente.”</blockquote>
        <div className="small" style={{ color: "#9c9185" }}>A IA propõe. Você escolhe. A IA executa.</div>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <div>
            <div className="eyebrow">Acesso privado</div>
            <h1 style={{ marginTop: 6 }}>Entrar no estúdio</h1>
          </div>
          {error && <div className="alert" role="alert">{error}</div>}
          <label className="field">
            <span className="label">E-mail</span>
            <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Senha</span>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Entrando…" : "Entrar"}</button>
        </form>
      </div>
    </div>
  );
}
