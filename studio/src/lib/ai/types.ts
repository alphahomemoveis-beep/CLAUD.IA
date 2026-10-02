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
}

export interface StructuredRequest<T> {
  /** Nome do esquema; também usado pelo provedor de teste. */
  schemaName: string;
  schema: ZodType<T>;
  system: string;
  messages: ChatTurn[];
  images?: InputImage[];
  webSearch?: boolean;
  model: string;
}

export interface StructuredResult<T> {
  data: T;
  sources: Source[];
  model: string;
}

export interface ImageRequest {
  prompt: string;
  model: string;
  size: string;
  quality: string;
  /** Referências visuais aprovadas, usadas como entrada quando o modelo aceita. */
  referenceImages?: InputImage[];
}

export interface ImageResult {
  data: Buffer;
  mime: string;
  ext: string;
  model: string;
}

/**
 * Contrato de qualquer provedor de IA. O restante do app só conhece esta
 * interface, então trocar de modelo ou de empresa é trocar a implementação.
 */
export interface AIProvider {
  readonly name: string;
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(texts: string[], model: string): Promise<number[][]>;
  image(req: ImageRequest): Promise<ImageResult>;
}
