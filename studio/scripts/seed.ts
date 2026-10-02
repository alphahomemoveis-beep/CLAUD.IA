import pg from "pg";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";
import { ensureBrand } from "../src/lib/brand-defaults";
import { pgConfig } from "../src/lib/pg-config";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const client = new pg.Client(pgConfig());
  await client.connect();

  await client.query("BEGIN");
  await ensureBrand(client as never);
  await client.query("COMMIT");
  console.log("Marca e Prompt Mestre prontos.");

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const weak = validatePasswordStrength(password);
    if (weak) throw new Error(weak);
    const exists = (await client.query(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [email])).rowCount;
    if (!exists) {
      await client.query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'owner')`, [
        email.toLowerCase(), process.env.SEED_ADMIN_NAME || "AlphaHome", await hashPassword(password),
      ]);
      console.log(`Usuário dono criado: ${email}`);
    }
  } else if (!(await client.query(`SELECT 1 FROM users LIMIT 1`)).rowCount) {
    console.log("Nenhum usuário criado. Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD e rode de novo.");
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
