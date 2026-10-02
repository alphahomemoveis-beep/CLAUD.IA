"use client";

/** Chamada à API própria. A chave da OpenAI nunca passa por aqui. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/login")) {
    window.location.href = "/login";
  }
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status}`);
  return data as T;
}

export const pad = (n: number) => String(n).padStart(2, "0");

export function fmtDate(iso: string | null | undefined, withTime = true) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", withTime ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", year: "numeric" });
}
