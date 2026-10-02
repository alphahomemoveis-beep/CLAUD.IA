import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { queryOne } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { assertSameOrigin, clientIp, enforceRate } from "@/lib/api";
import { errorResponse, unauthorized } from "@/lib/errors";
import { logActivity } from "@/lib/activity";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

// Hash fixo para gastar o mesmo tempo quando o e-mail não existe.
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const ip = clientIp(req);
    enforceRate(`login:${ip ?? "desconhecido"}`, "login");
    const { email, password } = Body.parse(await req.json());
    const user = await queryOne<{ id: string; password_hash: string; disabled: boolean }>(
      `SELECT id, password_hash, disabled FROM users WHERE lower(email) = lower($1)`, [email],
    );
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY);
    if (!user || !ok || user.disabled) {
      await logActivity(user?.id ?? null, "login_falhou", "users", undefined, { email }, ip);
      throw unauthorized("E-mail ou senha incorretos.");
    }
    await createSession(user.id, ip, req.headers.get("user-agent"));
    await logActivity(user.id, "login", "users", user.id, undefined, ip);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
