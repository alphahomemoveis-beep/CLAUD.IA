import "server-only";
import OpenAI, { toFile } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentResult, EmbeddingProvider, ImageProvider, ImageRequest, ImageResult, Source, StructuredRequest, StructuredResult, TextProvider } from "./types";
import { AIError } from "./types";
import { toStrictJsonSchema } from "./json-schema";
import { log } from "../logger";

/**
 * Texto pela OpenAI (alternativa ao Claude): Responses API com saída
 * estruturada estrita e a ferramenta web_search.
 */
export class OpenAIText implements TextProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, timeout: 180_000 });
  }

  async agent(): Promise<AgentResult> {
    throw new AIError("A agenda por conversa usa o Claude. Configure AI_PROVIDER=anthropic.", "indisponivel");
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const input: ResponseInputItem[] = req.messages.map((m, i) => {
      const isLast = i === req.messages.length - 1;
      if (m.role === "user" && isLast && req.images?.length) {
        return {
          role: "user",
          content: [
            { type: "input_text", text: m.text },
            ...req.images.map((img) => ({
              type: "input_image" as const,
              image_url: `data:${img.mime};base64,${img.data.toString("base64")}`,
              detail: "high" as const,
            })),
          ],
        };
      }
      return { role: m.role, content: m.text };
    });

    const format = {
      type: "json_schema" as const,
      name: req.schemaName,
      schema: toStrictJsonSchema(req.schema),
      strict: true,
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.client.responses.create({
        model: req.model,
        instructions: req.system,
        input,
        text: { format },
        tools: req.webSearch ? [{ type: "web_search", user_location: { type: "approximate", country: "BR" } }] : undefined,
        store: false,
      });
      const sources = collectSources(res.output);
      try {
        const data = req.schema.parse(JSON.parse(res.output_text));
        return { data, sources, model: res.model };
      } catch (err) {
        lastError = err;
        log.warn("saida_estruturada_invalida", { schema: req.schemaName, attempt, err: String(err).slice(0, 500) });
        input.push({ role: "assistant", content: res.output_text });
        input.push({
          role: "user",
          content: `A resposta anterior não passou na validação: ${String(err).slice(0, 800)}. Corrija e responda de novo seguindo o esquema.`,
        });
      }
    }
    throw lastError;
  }

}

/** Embeddings pela OpenAI. */
export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly name = "openai";
  private client: OpenAI;
  constructor(apiKey: string, readonly model: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 2 });
  }
  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({ model: this.model, input: texts });
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/** Geração de imagem pela Image API (o Claude não gera imagens). */
export class OpenAIImages implements ImageProvider {
  readonly name = "openai";
  private client: OpenAI;
  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 2, timeout: 300_000 });
  }

  async image(req: ImageRequest): Promise<ImageResult> {
    const common = { model: req.model, prompt: req.prompt, size: req.size, quality: req.quality as "high", n: 1 };
    const res = req.referenceImages?.length
      ? await this.client.images.edit({
          ...common,
          image: await Promise.all(
            req.referenceImages.slice(0, 8).map((img, i) =>
              toFile(img.data, `referencia-${i + 1}.${img.mime.split("/")[1] ?? "png"}`, { type: img.mime }),
            ),
          ),
        })
      : await this.client.images.generate({ ...common, output_format: "png" });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("O modelo de imagem não devolveu nenhuma imagem.");
    return { data: Buffer.from(b64, "base64"), mime: "image/png", ext: "png", model: req.model };
  }
}

function collectSources(output: unknown[]): Source[] {
  const seen = new Map<string, Source>();
  for (const item of output as Array<{ type?: string; content?: Array<{ annotations?: Array<Record<string, string>> }> }>) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      for (const a of part.annotations ?? []) {
        if (a.type === "url_citation" && a.url && !seen.has(a.url)) seen.set(a.url, { url: a.url, title: a.title ?? a.url });
      }
    }
  }
  return [...seen.values()];
}
