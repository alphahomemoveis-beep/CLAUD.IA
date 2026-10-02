import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "../db";
import { env } from "../env";

export const SESSION_COOKIE = "ahs_session";

export type Role = "owner" | "editor" | "viewer";
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Cria a sessão no banco e grava o cookie httpOnly. O token puro nunca é salvo. */
export async function createSession(userId: string, ip: string | null, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const days = env().SESSION_DAYS;
  const expires = new Date(Date.now() + days * 86400_000);
  await query(
    `INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [hashToken(token), userId, ip, userAgent?.slice(0, 300) ?? null, expires],
  );
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
  jar.delete(SESSION_COOKIE);
}

/** Retorna o usuário da sessão atual, ou null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return queryOne<SessionUser>(
    `SELECT u.id, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`,
    [hashToken(token)],
  );
}
