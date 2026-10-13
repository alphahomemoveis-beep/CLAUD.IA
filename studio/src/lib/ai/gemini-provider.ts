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

  /** Modelos de reserva, usados quando o principal está cheio ou sem cota. */
  private fallbacks: string[];

  constructor(private apiKey: string, fallbacks?: string[]) {
    this.fallbacks = fallbacks ?? ["gemini-flash-lite-latest"];
  }

  /**
   * Chama o Gemini com as regras da faixa grátis: espera o tempo que o Google
   * pede no limite por minuto, tenta de novo quando o modelo está cheio e,
   * se ainda assim não der, passa para o modelo mais leve, que tem cota própria.
   */
  private async generate(model: string, body: Record<string, unknown>): Promise<GenerateResponse> {
    const models = [model, ...this.fallbacks.filter((m) => m !== model)];
    let last: { status: number; body: string } = { status: 0, body: "" };
    for (const m of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        let res: Response;
        try {
          res = await fetch(`${BASE}/models/${encodeURIComponent(m)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(180_000),
          });
        } catch (err) {
          last = { status: 0, body: String(err) };
          if (attempt < 2) { await this.sleep(2000 * (attempt + 1)); continue; }
          break;
        }
        if (res.ok) return (await res.json()) as GenerateResponse;
        last = { status: res.status, body: (await res.text()).slice(0, 1500) };
        if (res.status === 400 && /api key/i.test(last.body)) throw new AIError("A chave do Gemini (GEMINI_API_KEY) é inválida.", "indisponivel");
        if (res.status === 401) throw new AIError("O Gemini recusou a chave (GEMINI_API_KEY). Crie uma chave nova no Google AI Studio e troque na Railway.", "indisponivel");
        if (res.status === 403) throw new AIError("O Gemini recusou a chave (GEMINI_API_KEY). Confira se ela foi criada no Google AI Studio.", "indisponivel");
        if (res.status === 404) break; // modelo não existe: tenta o próximo
        if (res.status === 429) {
          if (/limit:\s*0\b/.test(last.body) && m === models.at(-1)) {
            throw new AIError("O Google não liberou a faixa gratuita para o projeto dessa chave. No Google AI Studio, crie a chave num projeto novo.", "indisponivel");
          }
          if (/PerDay/i.test(last.body) || /limit:\s*0\b/.test(last.body)) break; // cota do dia deste modelo acabou: próximo modelo
          const wait = GeminiProvider.retryDelay(last.body);
          if (attempt < 2 && wait <= 45_000) { await this.sleep(wait); continue; }
          break;
        }
        if (res.status >= 500 && attempt < 2) { await this.sleep(3000 * (attempt + 1)); continue; }
        if (res.status >= 500) break;
        log.warn("gemini_erro", { model: m, status: res.status, err: last.body.slice(0, 500) });
        throw new AIError(`O Gemini respondeu com erro ${res.status}. Tente de novo.`);
      }
      log.warn("gemini_troca_modelo", { de: m, status: last.status, err: last.body.slice(0, 300) });
    }
    if (last.status === 429) {
      throw new AIError(/PerDay/i.test(last.body)
        ? "A cota grátis de hoje do Gemini acabou. Ela volta amanhã."
        : "O Gemini grátis recebeu pedidos demais seguidos. Espere 1 ou 2 minutos e tente de novo.", "limite");
    }
    if (last.status === 404) throw new AIError(`O modelo ${model} não existe no Gemini. Ajuste AI_TEXT_MODEL.`, "indisponivel");
    throw new AIError("O Gemini está sobrecarregado agora (é a versão grátis). Tente de novo em alguns minutos.", "indisponivel");
  }

  /** Tempo de espera que o Google pede ("retryDelay": "37s"), com folga; padrão de 5 s. */
  static retryDelay(body: string) {
    const s = Number(body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)?.[1]);
    return Number.isFinite(s) && s > 0 ? Math.ceil(s * 1000) + 500 : 5000;
  }

  protected sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
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
    let research: GenerateResponse | null = null;
    if (req.webSearch) {
      try {
        research = await this.generate(req.model, {
          systemInstruction: { parts: [{ text: `${req.system}\n\nPesquise no Google e escreva notas objetivas em português, dizendo de onde veio cada informação e a data da fonte.` }] },
          contents,
          tools: [{ google_search: {} }],
        });
        this.check(research);
      } catch (err) {
        // Sem pesquisa (cota da busca ou modelo cheio), a resposta sai assim mesmo, avisando.
        if (!(err instanceof AIError) || err.kind === "recusa") throw err;
        log.warn("gemini_pesquisa_indisponivel", { err: err.message });
        contents = [...contents, { role: "user", parts: [{ text: "A pesquisa na web não está disponível agora. Responda com o seu conhecimento, deixe claro nas tendências que elas não vêm de pesquisa feita hoje e deixe fonte_url vazio." }] }];
      }
    }
    if (research) {
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
