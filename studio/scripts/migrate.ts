import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await client.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
  const dir = path.resolve("db/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
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
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
