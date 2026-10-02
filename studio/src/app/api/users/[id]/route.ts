import { z } from "zod";
import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { logActivity } from "@/lib/activity";

const Patch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  role: z.enum(["owner", "editor", "viewer"]).optional(),
  disabled: z.boolean().optional(),
  password: z.string().max(200).optional(),
});

export const PATCH = route<{ id: string }>(async ({ params, req, user }) => {
  const b = Patch.parse(await req.json());
  const target = await queryOne<{ id: string; role: string }>(`SELECT id, role FROM users WHERE id = $1`, [params.id]);
  if (!target) throw notFound("Usuário não encontrado.");
  if (target.id === user.id && (b.disabled || (b.role && b.role !== "owner"))) {
    throw badRequest("Você não pode desativar nem rebaixar a própria conta.");
  }
  let hash: string | null = null;
  if (b.password) {
    const weak = validatePasswordStrength(b.password);
    if (weak) throw badRequest(weak);
    hash = await hashPassword(b.password);
  }
  await query(
    `UPDATE users SET name = COALESCE($1,name), role = COALESCE($2,role), disabled = COALESCE($3,disabled),
            password_hash = COALESCE($4,password_hash) WHERE id = $5`,
    [b.name ?? null, b.role ?? null, b.disabled ?? null, hash, target.id],
  );
  if (b.disabled || hash) await query(`DELETE FROM sessions WHERE user_id = $1`, [target.id]);
  await logActivity(user.id, "usuario_atualizado", "users", target.id, { campos: Object.keys(b).filter((k) => k !== "password") });
  return json({ ok: true });
}, { role: "owner" });
