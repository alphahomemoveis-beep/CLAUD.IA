"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

export default function FirstAccessPage() {
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ needed: boolean }>("/api/auth/setup").then((d) => setNeeded(d.needed)).catch(() => setNeeded(false)); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) return setError("As senhas não conferem.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/setup", { method: "POST", json: { name: form.name, email: form.email, password: form.password } });
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="login">
      <div className="login-art">
        <div>
          <div className="script">AlphaHome</div>
          <div className="eyebrow" style={{ color: "#b9ab99", marginTop: 10 }}>Creative Studio · Primeiro acesso</div>
        </div>
        <blockquote>Crie a conta do dono. Depois, em Configurações, você convida gerentes e outros donos.</blockquote>
        <div className="small" style={{ color: "#9c9185" }}>Esta tela só funciona uma vez.</div>
      </div>
      <div className="login-form">
        {needed === null && <span className="spinner" />}
        {needed === false && (
          <div className="stack" style={{ maxWidth: 360 }}>
            <h1>Acesso já configurado</h1>
            <p className="muted">O estúdio já tem uma conta de dono. Entre com seu e-mail e senha.</p>
            <a className="btn btn-primary" href="/login">Ir para o login</a>
          </div>
        )}
        {needed && (
          <form onSubmit={submit}>
            <div><div className="eyebrow">Primeiro acesso</div><h1 style={{ marginTop: 6 }}>Criar conta do dono</h1></div>
            {error && <div className="alert" role="alert">{error}</div>}
            <label className="field"><span className="label">Seu nome</span><input className="input" required value={form.name} onChange={set("name")} /></label>
            <label className="field"><span className="label">E-mail</span><input className="input" type="email" required autoComplete="email" value={form.email} onChange={set("email")} /></label>
            <label className="field"><span className="label">Senha</span><input className="input" type="password" required autoComplete="new-password" value={form.password} onChange={set("password")} /><span className="hint">Mínimo de 10 caracteres, com letras e números.</span></label>
            <label className="field"><span className="label">Repita a senha</span><input className="input" type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} /></label>
            <button className="btn btn-primary" disabled={busy}>{busy ? "Criando…" : "Criar conta e entrar"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
