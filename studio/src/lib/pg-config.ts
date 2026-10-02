import type { PoolConfig } from "pg";

/**
 * Conexão com o PostgreSQL. Com DATABASE_CA_CERT (o certificado do Supabase,
 * em PEM), a conexão é criptografada e o servidor é verificado. O sslmode da
 * URL é removido nesse caso, porque ele sobrescreveria a configuração.
 */
export function pgConfig(url = process.env.DATABASE_URL ?? "", ca = process.env.DATABASE_CA_CERT): PoolConfig {
  if (!ca?.trim()) return { connectionString: url };
  const u = new URL(url);
  u.searchParams.delete("sslmode");
  return { connectionString: u.toString(), ssl: { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true } };
}
