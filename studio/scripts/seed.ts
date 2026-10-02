import pg from "pg";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";
import { DEFAULT_MASTER_PROMPT } from "./default-master-prompt";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let brand = (await client.query<{ id: string }>(`SELECT id FROM brand_settings ORDER BY created_at LIMIT 1`)).rows[0];
  if (!brand) {
    brand = (await client.query<{ id: string }>(
      `INSERT INTO brand_settings (name, positioning, identity, ai_settings) VALUES ($1,$2,$3,$4) RETURNING id`,
      [
        "AlphaHome",
        "Ambientes Planejados",
        JSON.stringify({
          atributos: "sofisticação + arquitetura + funcionalidade + exclusividade + desejo",
          tom_de_voz: "Elegante, seguro e próximo. Sem exagero e sem cara de catálogo.",
          publico: "Clientes interessados em ambientes planejados de alto padrão",
          instagram: "@alphahome.moveis",
          logo_regras: "A logo aparece de maneira elegante e discreta, sem competir com o ambiente.",
          assinatura_regras: "Cursiva + manuscrita + fina + sofisticada.",
          assinatura_fantasma: true,
          assinatura_fantasma_texto: "AlphaHome",
          cores_marca: ["Madeira natural", "Off-white", "Fendi", "Pedra clara", "LED quente"],
          evitar: "Filtro frio, excesso de texto, cara de catálogo, mistura de ambientes.",
        }),
        JSON.stringify({ web_search: true, concept_count: 5, image_quality: "high", use_reference_images: false, max_references: 6 }),
      ],
    )).rows[0];
    console.log("Marca AlphaHome criada.");
  }

  const hasPrompt = (await client.query(`SELECT 1 FROM master_prompts WHERE brand_id = $1 LIMIT 1`, [brand.id])).rowCount;
  if (!hasPrompt) {
    const m = (await client.query<{ id: string }>(
      `INSERT INTO master_prompts (brand_id, title, description) VALUES ($1,'Prompt Mestre AlphaHome','Identidade, estética e regras de criação') RETURNING id`,
      [brand.id],
    )).rows[0];
    await client.query(
      `INSERT INTO prompt_versions (master_prompt_id, version, content, notes, is_active) VALUES ($1,1,$2,'Versão inicial',true)`,
      [m.id, DEFAULT_MASTER_PROMPT],
    );
    console.log("Prompt Mestre inicial criado.");
  }

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
