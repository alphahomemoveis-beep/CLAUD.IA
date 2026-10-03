// Aplica as migrações em ordem. Roda sozinho ao iniciar o app em produção
// (npm run start:prod) e pode ser rodado à mão com: npm run db:migrate
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Mesma regra de src/lib/pg-config.ts: para o Supabase usa o certificado que
// vem no app (certs/), a não ser que DATABASE_CA_CERT ou o sslmode da URL digam outra coisa.
function config() {
  const url = process.env.DATABASE_URL ?? "";
  const ca = process.env.DATABASE_CA_CERT;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const u = new URL(url);
  const mode = u.searchParams.get("sslmode");
  if (mode === "disable" || mode === "no-verify") return { connectionString: url };
  const pem = ca?.trim()
    ? ca.replace(/\\n/g, "\n")
    : /\.supabase\.(com|co)$/i.test(u.hostname)
      ? readFileSync(path.resolve("certs/supabase-root-2021.crt"), "utf8")
      : null;
  if (!pem) return { connectionString: url };
  u.searchParams.delete("sslmode");
  return { connectionString: u.toString(), ssl: { ca: pem, rejectUnauthorized: true } };
}

const client = new pg.Client(config());
try {
  await client.connect();
} catch (err) {
  const msg = String(err?.message ?? err);
  if (/certificate|self.signed|SSL|TLS/i.test(msg)) {
    console.error(`Falha no certificado do banco (${msg}). Confira DATABASE_CA_CERT ou, como último recurso, acrescente ?sslmode=no-verify ao DATABASE_URL.`);
  } else if (/password authentication/i.test(msg)) {
    console.error("O banco recusou a senha. Confira a senha dentro do DATABASE_URL (a mesma criada no Supabase).");
  }
  throw err;
}
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  // Trava para duas instâncias subindo juntas não aplicarem a mesma migração.
  await client.query(`SELECT pg_advisory_lock(727272)`);
  const done = new Set((await client.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
  const dir = path.resolve("db/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    console.log(`Aplicando ${f}...`);
    await client.query("BEGIN");
    try {
      await client.query(readFileSync(path.join(dir, f), "utf8"));
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
  console.log("Banco atualizado.");
} finally {
  await client.end();
}
