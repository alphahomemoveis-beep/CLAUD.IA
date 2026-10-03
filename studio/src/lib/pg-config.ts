import { readFileSync } from "node:fs";
import path from "node:path";
import type { PoolConfig } from "pg";

const SUPABASE_HOST = /\.supabase\.(com|co)$/i;

/** Certificado raiz público do Supabase (Supabase Root 2021 CA, válido até 2031). */
export function bundledSupabaseCa(): string {
  return readFileSync(path.join(process.cwd(), "certs", "supabase-root-2021.crt"), "utf8");
}

/**
 * Conexão com o PostgreSQL. A conexão é criptografada e o servidor é verificado
 * quando há um certificado: o de DATABASE_CA_CERT ou, para o Supabase, o que já
 * vem no app. O sslmode da URL é removido nesse caso, porque ele sobrescreveria
 * a configuração. sslmode=disable ou sslmode=no-verify na URL são respeitados.
 */
export function pgConfig(
  url = process.env.DATABASE_URL ?? "",
  ca = process.env.DATABASE_CA_CERT,
  supabaseCa: () => string = bundledSupabaseCa,
): PoolConfig {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { connectionString: url };
  }
  const mode = u.searchParams.get("sslmode");
  if (mode === "disable" || mode === "no-verify") return { connectionString: url };
  const pem = ca?.trim() ? ca.replace(/\\n/g, "\n") : SUPABASE_HOST.test(u.hostname) ? supabaseCa() : null;
  if (!pem) return { connectionString: url };
  u.searchParams.delete("sslmode");
  return { connectionString: u.toString(), ssl: { ca: pem, rejectUnauthorized: true } };
}
