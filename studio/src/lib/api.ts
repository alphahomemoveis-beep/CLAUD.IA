import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser, type Role, type SessionUser } from "./auth/session";
import { AppError, errorResponse, forbidden, unauthorized } from "./errors";
import { checkRate, RATE_RULES, type RateRule } from "./rate-limit";
import { env } from "./env";
import { log } from "./logger";

export interface HandlerCtx<P> {
  req: NextRequest;
  user: SessionUser;
  params: P;
  ip: string | null;
}

interface Options {
  /** Papel mínimo exigido. viewer < editor < owner. */
  role?: Role;
  rate?: keyof typeof RATE_RULES | RateRule;
}

const ROLE_LEVEL: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

/**
 * Bloqueia requisições que mudam dados vindas de outra origem (proteção CSRF
 * além do cookie SameSite=Lax).
 */
export function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // clientes sem navegador (curl) não mandam Origin; o cookie ainda é exigido
  const allowed = new Set<string>([req.nextUrl.origin]);
  const appUrl = env().APP_URL;
  if (appUrl) allowed.add(new URL(appUrl).origin);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }
  if (!allowed.has(origin)) throw new AppError(403, "Origem da requisição não permitida.", "origem_invalida");
}

export function enforceRate(key: string, rate: Options["rate"]) {
  const rule = typeof rate === "string" ? RATE_RULES[rate] : rate ?? RATE_RULES.default;
  const res = checkRate(key, rule);
  if (!res.ok) {
    throw new AppError(429, `Muitas requisições. Tente de novo em ${res.retryAfterSec} segundos.`, "limite_excedido");
  }
}

/** Envolve uma rota da API com autenticação, permissão, limite e tratamento de erro. */
export function route<P = Record<string, string>>(
  fn: (ctx: HandlerCtx<P>) => Promise<NextResponse | Response>,
  opts: Options = {},
) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    const started = Date.now();
    let userId: string | undefined;
    try {
      assertSameOrigin(req);
      const user = await getSessionUser();
      if (!user) throw unauthorized();
      userId = user.id;
      if (opts.role && ROLE_LEVEL[user.role] < ROLE_LEVEL[opts.role]) throw forbidden();
      const bucket = typeof opts.rate === "string" ? opts.rate : "default";
      enforceRate(`${bucket}:${user.id}`, opts.rate);
      const params = (await context.params) ?? ({} as P);
      const res = await fn({ req, user, params, ip: clientIp(req) });
      log.debug("api", { method: req.method, path: req.nextUrl.pathname, ms: Date.now() - started, status: res.status });
      return res;
    } catch (err) {
      const res = errorResponse(err);
      log.info("api_erro", { method: req.method, path: req.nextUrl.pathname, status: res.status, userId, ms: Date.now() - started });
      return res;
    }
  };
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
