import "server-only";
import { env } from "../env";
import { MockProvider } from "./mock-provider";
import { OpenAIProvider } from "./openai-provider";
import type { AIProvider } from "./types";

let provider: AIProvider | null = null;

/** Provedor de IA escolhido por AI_PROVIDER. A chave nunca sai do servidor. */
export function ai(): AIProvider {
  if (provider) return provider;
  const e = env();
  provider = e.AI_PROVIDER === "mock" ? new MockProvider() : new OpenAIProvider(e.OPENAI_API_KEY!);
  return provider;
}

/** Tamanho da imagem para a proporção pedida, conforme o que o modelo aceita. */
export function imageSizeFor(model: string, ratio: "4:5" | "9:16" | "1:1"): string {
  const flexible = /^gpt-image-2/.test(model) || model === "mock";
  if (flexible) return { "4:5": "1088x1360", "9:16": "1088x1936", "1:1": "1024x1024" }[ratio];
  return { "4:5": "1024x1536", "9:16": "1024x1536", "1:1": "1024x1024" }[ratio];
}
