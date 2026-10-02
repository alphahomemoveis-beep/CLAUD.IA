"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

const NAV = [
  { href: "/", label: "Novo projeto", icon: "✨" },
  { href: "/conversas", label: "Conversas", icon: "💬" },
  { href: "/projetos", label: "Projetos", icon: "📁" },
  { href: "/pastas", label: "Pastas de obras", icon: "🗂️" },
  { href: "/agenda", label: "Agenda de posts", icon: "📅" },
  { href: "/jornal", label: "Jornal", icon: "📰" },
  { href: "/widget", label: "Instagram ao vivo", icon: "📈" },
  { href: "/biblioteca", label: "Biblioteca visual", icon: "🖼️" },
  { href: "/memoria", label: "Memória da marca", icon: "🧠" },
  { href: "/identidade", label: "Identidade", icon: "🎨" },
  { href: "/insights", label: "Insights", icon: "📊" },
  { href: "/configuracoes", label: "Configurações", icon: "⚙️" },
];

interface Props { user: { name: string; email: string; role: string } }
interface Conv { id: string; title: string }

export function Sidebar({ user }: Props) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<Conv[]>([]);
  const [newHref, setNewHref] = useState("/?novo=1");

  useEffect(() => {
    const refresh = () => api<{ conversations: Conv[] }>("/api/conversations").then((d) => setRecent(d.conversations.slice(0, 8))).catch(() => undefined);
    window.addEventListener("alphahome:conversas", refresh);
    return () => window.removeEventListener("alphahome:conversas", refresh);
  }, []);

  useEffect(() => {
    setOpen(false);
    setNewHref(`/?novo=${Date.now()}`);
    api<{ conversations: Conv[] }>("/api/conversations").then((d) => setRecent(d.conversations.slice(0, 8))).catch(() => undefined);
  }, [path]);

  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <>
      <div className="topbar">
        <span className="script">AlphaHome</span>
        <button aria-label="Abrir menu" onClick={() => setOpen(true)}>☰</button>
      </div>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link href="/" className="brandmark">
          <div className="script">AlphaHome</div>
          <div className="sub">Creative Studio</div>
        </Link>
        <Link href={newHref} className="newchat">＋ Novo chat</Link>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href === "/" ? newHref : n.href} className={isActive(n.href) ? "active" : ""}>
              <span className="ico" aria-hidden>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        {recent.length > 0 && (
          <div>
            <div className="side-section" style={{ marginBottom: 6 }}>Recentes</div>
            <div className="recent">
              {recent.map((c) => (
                <Link key={c.id} href={`/chat/${c.id}`} className={path === `/chat/${c.id}` ? "active" : ""}>{c.title}</Link>
              ))}
            </div>
          </div>
        )}
        <div className="side-foot">
          <div>{user.name}</div>
          <div className="spread" style={{ color: "var(--side-muted)", fontSize: 12 }}>
            <span>{user.role === "owner" ? "Dono" : user.role === "editor" ? "Gerente" : "Leitura"}</span>
            <button onClick={logout}>Sair</button>
          </div>
        </div>
      </aside>
    </>
  );
}
