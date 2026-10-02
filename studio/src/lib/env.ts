import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  AI_PROVIDER: z.enum(["openai", "mock"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  AI_TEXT_MODEL: z.string().default("gpt-5.5"),
  AI_VISION_MODEL: z.string().default("gpt-5.5"),
  AI_IMAGE_MODEL: z.string().default("gpt-image-2.5-sunburst"),
  AI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  STORAGE_DIR: z.string().default("./data/uploads"),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_BUCKET: z.string().default("alphahome-studio"),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(200).default(25),
  APP_URL: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

/** Lê e valida as variáveis de ambiente do servidor uma única vez. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${issues}`);
  }
  if (parsed.data.AI_PROVIDER === "openai" && !parsed.data.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY é obrigatória quando AI_PROVIDER=openai");
  }
  if (parsed.data.STORAGE_DRIVER === "supabase" && (!parsed.data.SUPABASE_URL || !parsed.data.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias quando STORAGE_DRIVER=supabase");
  }
  cached = parsed.data;
  return cached;
}
