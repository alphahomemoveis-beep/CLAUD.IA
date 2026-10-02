import { z } from "zod";
import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { badRequest, conflict } from "@/lib/errors";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { logActivity } from "@/lib/activity";

export const GET = route(async () => {
  const users = await query(`SELECT id, email, name, role, disabled, last_login_at, created_at FROM users ORDER BY created_at`);
  return json({ users });
}, { role: "owner" });

const Body = z.object({
  email: z.string().email().max(200),
  name: z.string().trim().min(1).max(80),
  password: z.string().max(200),
  role: z.enum(["owner", "editor", "viewer"]).default("editor"),
});

export const POST = route(async ({ req, user }) => {
  const b = Body.parse(await req.json());
  const weak = validatePasswordStrength(b.password);
  if (weak) throw badRequest(weak);
  const exists = await queryOne(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [b.email]);
  if (exists) throw conflict("Já existe um usuário com este e-mail.");
  const created = await queryOne<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
    [b.email.toLowerCase(), b.name, await hashPassword(b.password), b.role],
  );
  await logActivity(user.id, "usuario_criado", "users", created!.id, { papel: b.role });
  return json({ ok: true }, 201);
}, { role: "owner" });
