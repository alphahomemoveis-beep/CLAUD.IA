import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link temporário e assinado para uma mídia. O Metricool precisa de uma URL
 * pública para buscar o vídeo; o link vale só para aquela mídia e expira.
 */
export function signMediaToken(mediaId: string, expiresAtMs: number, secret: string): string {
  const body = Buffer.from(JSON.stringify({ m: mediaId, e: Math.floor(expiresAtMs / 1000) })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyMediaToken(token: string, secret: string, nowMs = Date.now()): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { m, e } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { m: string; e: number };
    if (typeof m !== "string" || typeof e !== "number" || e * 1000 < nowMs) return null;
    return m;
  } catch {
    return null;
  }
}
