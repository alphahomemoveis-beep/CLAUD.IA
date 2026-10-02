import "server-only";
import { mimeFromKey, storage } from "./storage";
import { notFound } from "./errors";

/** Entrega um arquivo do armazenamento só para quem está logado. */
export async function serveFile(key: string | null | undefined, download?: string) {
  if (!key) throw notFound("Arquivo não encontrado.");
  const data = await storage().get(key);
  if (!data) throw notFound("Arquivo não encontrado.");
  const headers: Record<string, string> = {
    "Content-Type": mimeFromKey(key),
    "Cache-Control": "private, max-age=3600",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^a-zA-Z0-9._-]/g, "_")}"`;
  return new Response(new Uint8Array(data), { headers });
}
