import "server-only";
import { z } from "zod";

const optional = z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),

  // Cérebro do estúdio: texto, visão, pesquisa e conversa da agenda.
  // "none" = IA desligada: o app liga e o que não depende de IA funciona.
  // Sem AI_PROVIDER definido, usa o Claude se houver chave; senão, desligada.
  AI_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["anthropic", "openai", "mock", "none"]).optional()),
  ANTHROPIC_API_KEY: optional,
  OPENAI_API_KEY: optional,
  AI_TEXT_MODEL: optional,
  AI_VISION_MODEL: optional,

  // O Claude não gera imagens. "manual" entrega o prompt final e recebe a imagem pronta.
  IMAGE_PROVIDER: z.enum(["manual", "openai", "mock"]).default("manual"),
  AI_IMAGE_MODEL: z.string().default("gpt-image-2.5-sunburst"),

  // O Claude não gera embeddings. "none" usa busca de texto completo no PostgreSQL.
  EMBEDDING_PROVIDER: z.enum(["none", "voyage", "openai", "mock"]).default("none"),
  VOYAGE_API_KEY: optional,
  AI_EMBEDDING_MODEL: optional,

  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  STORAGE_DIR: z.string().default("./data/uploads"),
  SUPABASE_URL: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  SUPABASE_BUCKET: z.string().default("alphahome-studio"),

  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(200).default(25),
  FOLDER_MAX_UPLOAD_MB: z.coerce.number().min(1).max(1024).default(300),
  APP_URL: optional,
  APP_TIMEZONE: z.string().default("America/Sao_Paulo"),
  // Assina os links temporários de mídia enviados ao Metricool.
  APP_SECRET: optional,
  // Protege a rota de sincronização chamada pelo agendador (cron).
  CRON_SECRET: optional,

  METRICOOL_USER_TOKEN: optional,
  METRICOOL_USER_ID: optional,
  METRICOOL_BLOG_ID: optional,
  WINDSOR_API_KEY: optional,
});

export type ServerEnv = Omit<z.infer<typeof schema>, "AI_PROVIDER"> & { AI_PROVIDER: "anthropic" | "openai" | "mock" | "none" };

let cached: ServerEnv | null = null;

/** Lê e valida as variáveis de ambiente do servidor uma única vez. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${issues}`);
  }
  const e = { ...parsed.data, AI_PROVIDER: parsed.data.AI_PROVIDER ?? (parsed.data.ANTHROPIC_API_KEY ? "anthropic" : "none") } as const;
  const need = (cond: boolean, msg: string) => { if (cond) throw new Error(msg); };
  need(e.AI_PROVIDER === "anthropic" && !e.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY é obrigatória quando AI_PROVIDER=anthropic");
  need(e.AI_PROVIDER === "openai" && !e.OPENAI_API_KEY, "OPENAI_API_KEY é obrigatória quando AI_PROVIDER=openai");
  need(e.IMAGE_PROVIDER === "openai" && !e.OPENAI_API_KEY, "OPENAI_API_KEY é obrigatória quando IMAGE_PROVIDER=openai");
  need(e.EMBEDDING_PROVIDER === "voyage" && !e.VOYAGE_API_KEY, "VOYAGE_API_KEY é obrigatória quando EMBEDDING_PROVIDER=voyage");
  need(e.EMBEDDING_PROVIDER === "openai" && !e.OPENAI_API_KEY, "OPENAI_API_KEY é obrigatória quando EMBEDDING_PROVIDER=openai");
  need(e.STORAGE_DRIVER === "supabase" && (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY),
    "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias quando STORAGE_DRIVER=supabase");
  need(!!e.APP_SECRET && e.APP_SECRET.length < 32, "APP_SECRET precisa ter pelo menos 32 caracteres");
  cached = e;
  return cached;
}

/** Modelos padrão de cada provedor de texto. */
export function defaultTextModel(provider: ServerEnv["AI_PROVIDER"]) {
  return provider === "anthropic" ? "claude-opus-5-5" : provider === "openai" ? "gpt-5.5" : provider === "none" ? "desligada" : "mock";
}

export function defaultEmbeddingModel(provider: ServerEnv["EMBEDDING_PROVIDER"]) {
  return { none: "texto-completo", voyage: "voyage-3.5", openai: "text-embedding-3-small", mock: "mock-hash-256" }[provider];
}
