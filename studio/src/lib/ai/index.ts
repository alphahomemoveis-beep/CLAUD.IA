import "server-only";
import { defaultEmbeddingModel, env } from "../env";
import { AnthropicProvider } from "./anthropic-provider";
import { MockEmbeddings, MockImages, MockText } from "./mock-provider";
import { OpenAIEmbeddings, OpenAIImages, OpenAIText } from "./openai-provider";
import { VoyageEmbeddings } from "./voyage-embeddings";
import { AIError, type EmbeddingProvider, type ImageProvider, type TextProvider } from "./types";

export const AI_OFF_MESSAGE =
  "A IA do aplicativo está desligada (sem chave da Anthropic). Pastas, agenda manual, jornal e widget continuam funcionando. Para criar com IA, peça ao Claude no chat ou cadastre ANTHROPIC_API_KEY na Railway.";

/** IA desligada: qualquer pedido de IA responde com uma mensagem clara. */
class DisabledText implements TextProvider {
  readonly name = "none";
  async structured(): Promise<never> {
    throw new AIError(AI_OFF_MESSAGE, "indisponivel");
  }
  async agent(): Promise<never> {
    throw new AIError(AI_OFF_MESSAGE, "indisponivel");
  }
}

export const aiEnabled = () => env().AI_PROVIDER !== "none";

let textP: TextProvider | null = null;
let imageP: ImageProvider | null | undefined;
let embedP: EmbeddingProvider | null | undefined;

/** Cérebro do estúdio. Padrão: Claude. A chave nunca sai do servidor. */
export function text(): TextProvider {
  if (textP) return textP;
  const e = env();
  textP = e.AI_PROVIDER === "anthropic" ? new AnthropicProvider(e.ANTHROPIC_API_KEY!)
    : e.AI_PROVIDER === "openai" ? new OpenAIText(e.OPENAI_API_KEY!)
    : e.AI_PROVIDER === "none" ? new DisabledText() : new MockText();
  return textP;
}

/** Gerador de imagens, ou null no modo manual. */
export function images(): ImageProvider | null {
  if (imageP !== undefined) return imageP;
  const e = env();
  imageP = e.IMAGE_PROVIDER === "openai" ? new OpenAIImages(e.OPENAI_API_KEY!) : e.IMAGE_PROVIDER === "mock" ? new MockImages() : null;
  return imageP;
}

/** Provedor de embeddings, ou null quando a busca é por texto completo. */
export function embeddings(): EmbeddingProvider | null {
  if (embedP !== undefined) return embedP;
  const e = env();
  const model = e.AI_EMBEDDING_MODEL ?? defaultEmbeddingModel(e.EMBEDDING_PROVIDER);
  embedP = e.EMBEDDING_PROVIDER === "voyage" ? new VoyageEmbeddings(e.VOYAGE_API_KEY!, model)
    : e.EMBEDDING_PROVIDER === "openai" ? new OpenAIEmbeddings(e.OPENAI_API_KEY!, model)
    : e.EMBEDDING_PROVIDER === "mock" ? new MockEmbeddings() : null;
  return embedP;
}

/** Tamanho da imagem para a proporção pedida, conforme o que o modelo aceita. */
export function imageSizeFor(model: string, ratio: "4:5" | "9:16" | "1:1"): string {
  const flexible = /^gpt-image-2/.test(model) || model === "mock";
  if (flexible) return { "4:5": "1088x1360", "9:16": "1088x1936", "1:1": "1024x1024" }[ratio];
  return { "4:5": "1024x1536", "9:16": "1024x1536", "1:1": "1024x1024" }[ratio];
}
