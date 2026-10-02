import { z } from "zod";
import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { logActivity } from "@/lib/activity";

const Body = z.object({ current: z.string().max(200), next: z.string().max(200) });

/** Troca a própria senha e encerra as outras sessões. */
export const POST = route(async ({ req, user, ip }) => {
  const b = Body.parse(await req.json());
  const row = await queryOne<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
  if (!row || !(await verifyPassword(b.current, row.password_hash))) throw badRequest("A senha atual está incorreta.");
  const weak = validatePasswordStrength(b.next);
  if (weak) throw badRequest(weak);
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await hashPassword(b.next), user.id]);
  await logActivity(user.id, "senha_trocada", "users", user.id, undefined, ip);
  return json({ ok: true });
}, { rate: "login" });
