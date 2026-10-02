import type { ZodType } from "zod";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface InputImage {
  mime: string;
  data: Buffer;
}

export interface Source {
  url: string;
  title: string;
  /** Idade da página informada pela busca (ex.: "3 days ago"), quando houver. */
  page_age?: string | null;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface StructuredRequest<T> {
  /** Nome do esquema; também usado pelo provedor de teste. */
  schemaName: string;
  schema: ZodType<T>;
  system: string;
  messages: ChatTurn[];
  images?: InputImage[];
  webSearch?: boolean;
  model: string;
  effort?: Effort;
}

export interface StructuredResult<T> {
  data: T;
  sources: Source[];
  model: string;
}

/** Ferramenta que o agente pode chamar. O app executa e devolve o resultado. */
export interface AgentTool {
  name: string;
  description: string;
  schema: ZodType;
  run: (input: unknown) => Promise<unknown>;
}

export interface AgentRequest {
  system: string;
  messages: ChatTurn[];
  tools: AgentTool[];
  model: string;
  maxSteps?: number;
  effort?: Effort;
}

export interface AgentToolCall {
  name: string;
  input: unknown;
  output: unknown;
  error?: string;
}

export interface AgentResult {
  text: string;
  toolCalls: AgentToolCall[];
  model: string;
}

/** Texto, visão, pesquisa e agente. Hoje: Claude (padrão), OpenAI ou teste. */
export interface TextProvider {
  readonly name: string;
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  agent(req: AgentRequest): Promise<AgentResult>;
}

export interface ImageRequest {
  prompt: string;
  model: string;
  size: string;
  quality: string;
  referenceImages?: InputImage[];
}

export interface ImageResult {
  data: Buffer;
  mime: string;
  ext: string;
  model: string;
}

export interface ImageProvider {
  readonly name: string;
  image(req: ImageRequest): Promise<ImageResult>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** Erro de IA com mensagem segura para mostrar à pessoa. */
export class AIError extends Error {
  constructor(message: string, public readonly kind: "recusa" | "limite" | "formato" | "indisponivel" = "formato") {
    super(message);
  }
}
