import { DEFAULT_MASTER_PROMPT } from "./studio/default-master-prompt";

/** Marca inicial: criada sozinha no primeiro acesso (ou por npm run db:seed). */
export const DEFAULT_BRAND = {
  name: "AlphaHome",
  positioning: "Ambientes Planejados",
  identity: {
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
  },
  ai_settings: { web_search: true, concept_count: 5, image_quality: "high", use_reference_images: false, max_references: 6 },
  integrations: { instagram_handle: "alphahome.moveis" },
};

interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Cria a marca e o Prompt Mestre se ainda não existirem. Pode ser chamado várias vezes. */
export async function ensureBrand(db: Queryable): Promise<string> {
  await db.query(`SELECT pg_advisory_xact_lock(515151)`).catch(() => undefined);
  const found = (await db.query(`SELECT id FROM brand_settings ORDER BY created_at LIMIT 1`)).rows[0];
  if (found) return String(found.id);
  const b = DEFAULT_BRAND;
  const id = String((await db.query(
    `INSERT INTO brand_settings (name, positioning, identity, ai_settings, integrations) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [b.name, b.positioning, JSON.stringify(b.identity), JSON.stringify(b.ai_settings), JSON.stringify(b.integrations)],
  )).rows[0].id);
  const mp = (await db.query(
    `INSERT INTO master_prompts (brand_id, title, description) VALUES ($1,'Prompt Mestre AlphaHome','Identidade, estética e regras de criação') RETURNING id`,
    [id],
  )).rows[0].id;
  await db.query(`INSERT INTO prompt_versions (master_prompt_id, version, content, notes, is_active) VALUES ($1,1,$2,'Versão inicial',true)`, [mp, DEFAULT_MASTER_PROMPT]);
  return id;
}
