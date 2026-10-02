import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { queryOne, tx } from "@/lib/db";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { assertSameOrigin, clientIp, enforceRate } from "@/lib/api";
import { badRequest, conflict, errorResponse } from "@/lib/errors";
import { logActivity } from "@/lib/activity";
import { ensureBrand } from "@/lib/brand-defaults";

/** Diz se o app ainda não tem nenhum usuário (primeiro acesso). */
export async function GET() {
  try {
    const row = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`);
    return NextResponse.json({ needed: (row?.n ?? 0) === 0 });
  } catch (err) {
    return errorResponse(err);
  }
}

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email().max(200),
  password: z.string().max(200),
});

/** Cria a conta do dono. Só funciona enquanto não existe nenhum usuário. */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    enforceRate(`setup:${ip ?? "?"}`, "login");
    const b = Body.parse(await req.json());
    const weak = validatePasswordStrength(b.password);
    if (weak) throw badRequest(weak);
    const hash = await hashPassword(b.password);
    const user = await tx(async (db) => {
      // Trava para dois primeiros acessos simultâneos não criarem dois donos.
      await db.query(`SELECT pg_advisory_xact_lock(424242)`);
      const count = (await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`)).rows[0].n;
      if (count > 0) throw conflict("O primeiro acesso já foi feito. Entre com seu e-mail e senha.");
      await ensureBrand(db as never);
      return (await db.query<{ id: string }>(
        `INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'owner') RETURNING id`,
        [b.email.toLowerCase(), b.name, hash],
      )).rows[0];
    });
    await createSession(user.id, ip, req.headers.get("user-agent"));
    await logActivity(user.id, "primeiro_acesso", "users", user.id, undefined, ip);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
