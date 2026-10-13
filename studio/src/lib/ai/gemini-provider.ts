import "server-only";
import type { AgentRequest, AgentResult, AgentToolCall, Source, StructuredRequest, StructuredResult, TextProvider } from "./types";
import { AIError } from "./types";
import { toStrictJsonSchema } from "./json-schema";
import { log } from "../logger";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thought?: boolean;
  [k: string]: unknown;
}
interface Content {
  role: "user" | "model";
  parts: Part[];
}
interface GenerateResponse {
  candidates?: Array<{
    content?: Content;
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
}

/** O esquema do Gemini aceita menos palavras-chave; a validação com zod continua depois. */
function geminiSchema(schema: Record<string, unknown>): unknown {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (k !== "additionalProperties") out[k] = walk(v);
    return out;
  };
  return walk(schema);
}

/**
 * Google Gemini pela API REST. Tem uma faixa gratuita para os modelos Flash
 * (com limite de pedidos por dia), por isso é a opção sem custo do app.
 */
export class GeminiProvider implements TextProvider {
  readonly name = "gemini";

  constructor(private apiKey: string) {}

  private async generate(model: string, body: Record<string, unknown>): Promise<GenerateResponse> {
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) return (await res.json()) as GenerateResponse;
      lastErr = (await res.text()).slice(0, 500);
      if (res.status === 429) {
        if (/limit:\s*0\b/.test(lastErr)) throw new AIError("O Google não liberou a faixa gratuita para o projeto dessa chave. No Google AI Studio, crie a chave num projeto novo.", "indisponivel");
        if (attempt < 2) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); continue; }
        throw new AIError("O limite gratuito diário do Gemini acabou. Tente de novo mais tarde ou amanhã.", "limite");
      }
      if (res.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
      if (res.status === 400 && /api key/i.test(lastErr)) throw new AIError("A chave do Gemini (GEMINI_API_KEY) é inválida.", "indisponivel");
      if (res.status === 401) throw new AIError("O Gemini recusou a chave (GEMINI_API_KEY). Crie uma chave nova no Google AI Studio e troque na Railway.", "indisponivel");
      if (res.status === 403) throw new AIError("O Gemini recusou a chave (GEMINI_API_KEY). Confira se ela foi criada no Google AI Studio.", "indisponivel");
      if (res.status === 404) throw new AIError(`O modelo ${model} não existe no Gemini. Ajuste AI_TEXT_MODEL.`, "indisponivel");
      break;
    }
    log.warn("gemini_erro", { model, err: lastErr });
    throw new AIError(`O Gemini respondeu com erro: ${lastErr.slice(0, 200)}`);
  }

  private check(res: GenerateResponse) {
    if (res.promptFeedback?.blockReason) {
      throw new AIError("A IA não pôde atender este pedido por política de segurança. Reformule o pedido.", "recusa");
    }
    const reason = res.candidates?.[0]?.finishReason;
    if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || reason === "BLOCKLIST") {
      throw new AIError("A IA não pôde atender este pedido por política de segurança. Reformule o pedido.", "recusa");
    }
    if (reason === "MAX_TOKENS") throw new AIError("A resposta da IA ficou longa demais e foi cortada. Tente um pedido mais curto.", "limite");
  }

  private static text(res: GenerateResponse) {
    return (res.candidates?.[0]?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  }

  private contents(req: { messages: StructuredRequest<unknown>["messages"]; images?: StructuredRequest<unknown>["images"] }): Content[] {
    return req.messages.map((m, i) => {
      const parts: Part[] = [];
      if (m.role === "user" && i === req.messages.length - 1 && req.images?.length) {
        for (const img of req.images) parts.push({ inlineData: { mimeType: img.mime, data: img.data.toString("base64") } });
      }
      parts.push({ text: m.text });
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    let sources: Source[] = [];
    let contents = this.contents(req);

    // Mesma ideia do Claude: a busca do Google escreve notas com fontes e,
    // numa segunda chamada sem ferramentas, as notas viram JSON.
    if (req.webSearch) {
      const research = await this.generate(req.model, {
        systemInstruction: { parts: [{ text: `${req.system}\n\nPesquise no Google e escreva notas objetivas em português, dizendo de onde veio cada informação e a data da fonte.` }] },
        contents,
        tools: [{ google_search: {} }],
      });
      this.check(research);
      const chunks = research.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const seen = new Map<string, Source>();
      for (const c of chunks) if (c.web?.uri && !seen.has(c.web.uri)) seen.set(c.web.uri, { url: c.web.uri, title: c.web.title ?? c.web.uri, page_age: null });
      sources = [...seen.values()];
      contents = [...contents, {
        role: "user",
        parts: [{ text: `NOTAS DA PESQUISA NO GOOGLE (feita agora):\n${GeminiProvider.text(research) || "A busca não trouxe resultados úteis."}\n\nFONTES:\n${
          sources.map((s) => `- ${s.title} | ${s.url}`).join("\n") || "nenhuma"
        }\n\nAgora organize a resposta no formato pedido. Use só estas fontes quando citar links.` }],
      }];
    }

    const schema = geminiSchema(toStrictJsonSchema(req.schema));
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.generate(req.model, {
        systemInstruction: { parts: [{ text: req.system }] },
        contents,
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: 32000 },
      });
      this.check(res);
      const text = GeminiProvider.text(res);
      try {
        return { data: req.schema.parse(JSON.parse(text)), sources, model: res.modelVersion ?? req.model };
      } catch (err) {
        lastError = err;
        log.warn("saida_estruturada_invalida", { schema: req.schemaName, attempt, err: String(err).slice(0, 400) });
        contents = [...contents, { role: "model", parts: [{ text }] }, {
          role: "user",
          parts: [{ text: `A resposta não passou na validação: ${String(err).slice(0, 800)}. Responda de novo seguindo o formato.` }],
        }];
      }
    }
    throw new AIError(`A IA devolveu um formato inválido duas vezes: ${String(lastError).slice(0, 200)}`);
  }

  /** Agente com as ferramentas do app, por chamada de função. O app executa cada uma. */
  async agent(req: AgentRequest): Promise<AgentResult> {
    const tools = [{
      functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: toStrictJsonSchema(t.schema) })),
    }];
    const contents = this.contents({ messages: req.messages });
    const calls: AgentToolCall[] = [];
    const texts: string[] = [];
    let model = req.model;

    for (let step = 0; step < (req.maxSteps ?? 8); step++) {
      const res = await this.generate(req.model, { systemInstruction: { parts: [{ text: req.system }] }, contents, tools });
      this.check(res);
      model = res.modelVersion ?? model;
      const content = res.candidates?.[0]?.content;
      const said = GeminiProvider.text(res).trim();
      if (said) texts.push(said);
      const uses = (content?.parts ?? []).filter((p) => p.functionCall);
      if (!content || uses.length === 0) break;

      // A resposta do modelo volta inteira (inclui as assinaturas de raciocínio).
      contents.push(content);
      const responses: Part[] = [];
      for (const use of uses) {
        const name = use.functionCall!.name;
        const input = use.functionCall!.args ?? {};
        const tool = req.tools.find((t) => t.name === name);
        const parsed = tool?.schema.safeParse(input);
        if (!tool || !parsed?.success) {
          const error = tool ? `Entrada inválida: ${parsed?.error?.message.slice(0, 300)}` : `Ferramenta desconhecida: ${name}`;
          calls.push({ name, input, output: null, error });
          responses.push({ functionResponse: { name, response: { error } } });
          continue;
        }
        try {
          const output = await tool.run(parsed.data);
          calls.push({ name, input: parsed.data, output });
          responses.push({ functionResponse: { name, response: { result: output } } });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          calls.push({ name, input: parsed.data, output: null, error });
          responses.push({ functionResponse: { name, response: { error: error.slice(0, 500) } } });
        }
      }
      contents.push({ role: "user", parts: responses });
    }
    return { text: texts.join("\n\n"), toolCalls: calls, model };
  }
}
