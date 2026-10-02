import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentRequest, AgentResult, AgentToolCall, Effort, Source, StructuredRequest, StructuredResult, TextProvider } from "./types";
import { AIError } from "./types";
import { toStrictJsonSchema } from "./json-schema";
import { log } from "../logger";

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/**
 * Esforço por etapa: pensar mais onde a criação pede (conceitos, planejamento,
 * prompt final) e menos onde só é preciso classificar.
 */
const EFFORT_BY_SCHEMA: Record<string, Effort> = {
  intencao: "low", resposta: "low", licao_feedback: "low", briefing: "medium", analise_referencia: "medium",
  pesquisa: "medium", revisao_peca: "medium", editorial: "medium", conceitos: "high", planejamento: "high",
  prompts_finais: "high",
};

/**
 * Se o modelo recusar por segurança, a API tenta de novo num modelo
 * recomendado pela Anthropic para aquela categoria, na mesma chamada.
 */
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

export class AnthropicProvider implements TextProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    let sources: Source[] = [];
    let messages: BetaMessageParam[] = req.messages.map((m, i) => {
      const isLast = i === req.messages.length - 1;
      if (m.role === "user" && isLast && req.images?.length) {
        return {
          role: "user",
          content: [
            ...req.images.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mime as "image/png", data: img.data.toString("base64") },
            })),
            { type: "text" as const, text: m.text },
          ],
        };
      }
      return { role: m.role, content: m.text };
    });

    // Saída estruturada não combina com as citações da busca. Primeiro a
    // busca escreve notas com fontes; depois as notas viram JSON.
    if (req.webSearch) {
      const research = await this.research(req);
      sources = research.sources;
      messages = [...messages, {
        role: "user",
        content: `NOTAS DA PESQUISA NA WEB (fontes reais encontradas agora):\n${research.notes}\n\nFONTES CITADAS:\n${
          sources.map((s) => `- ${s.title} | ${s.url}${s.page_age ? ` | publicada: ${s.page_age}` : ""}`).join("\n") || "nenhuma"
        }\n\nAgora organize a pesquisa no formato pedido. Use só estas fontes em fonte_url.`,
      }];
    }

    const format = { type: "json_schema" as const, schema: toStrictJsonSchema(req.schema) };
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const msg = await this.client.beta.messages.stream({
        model: req.model,
        max_tokens: 32000,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { effort: req.effort ?? EFFORT_BY_SCHEMA[req.schemaName] ?? "medium", format },
        ...FALLBACK,
      }).finalMessage();
      this.checkStop(msg);
      const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      try {
        return { data: req.schema.parse(JSON.parse(text)), sources, model: msg.model };
      } catch (err) {
        lastError = err;
        log.warn("saida_estruturada_invalida", { schema: req.schemaName, attempt, err: String(err).slice(0, 400) });
        messages = [...messages, { role: "assistant", content: msg.content }, {
          role: "user",
          content: `A resposta não passou na validação: ${String(err).slice(0, 800)}. Responda de novo seguindo o formato.`,
        }];
      }
    }
    throw new AIError(`A IA devolveu um formato inválido duas vezes: ${String(lastError).slice(0, 200)}`);
  }

  /** Busca na web com a ferramenta do servidor da Anthropic e devolve notas + fontes. */
  private async research(req: StructuredRequest<unknown>): Promise<{ notes: string; sources: Source[] }> {
    const messages: BetaMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.text }));
    const sources = new Map<string, Source>();
    const notes: string[] = [];
    for (let turn = 0; turn < 4; turn++) {
      const msg = await this.client.beta.messages.stream({
        model: req.model,
        max_tokens: 16000,
        system: `${req.system}\n\nPesquise na web e escreva notas objetivas em português, citando de onde veio cada informação e a data da fonte.`,
        messages,
        tools: [{
          type: "web_search_20260209", name: "web_search", max_uses: 6,
          user_location: { type: "approximate", country: "BR", timezone: "America/Sao_Paulo" },
        }],
        output_config: { effort: "medium" },
        ...FALLBACK,
      }).finalMessage();
      for (const block of msg.content) {
        if (block.type === "text") notes.push(block.text);
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r.type === "web_search_result" && !sources.has(r.url)) sources.set(r.url, { url: r.url, title: r.title, page_age: r.page_age ?? null });
          }
        }
      }
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      this.checkStop(msg);
      break;
    }
    return { notes: notes.join("\n").trim() || "A busca não trouxe resultados úteis.", sources: [...sources.values()] };
  }

  /** Agente com ferramentas do app (agenda). Laço manual: o app executa cada ferramenta. */
  async agent(req: AgentRequest): Promise<AgentResult> {
    const tools: Anthropic.Beta.Messages.BetaTool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toStrictJsonSchema(t.schema) as Anthropic.Beta.Messages.BetaTool["input_schema"],
      strict: true,
    }));
    const messages: BetaMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.text }));
    const calls: AgentToolCall[] = [];
    const texts: string[] = [];
    let model = req.model;

    for (let step = 0; step < (req.maxSteps ?? 8); step++) {
      const params: BetaParams = {
        model: req.model,
        max_tokens: 16000,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages,
        tools,
        output_config: { effort: req.effort ?? "medium" },
        ...FALLBACK,
      };
      const msg = await this.client.beta.messages.create(params);
      model = msg.model;
      for (const b of msg.content) if (b.type === "text" && b.text.trim()) texts.push(b.text.trim());

      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      this.checkStop(msg);
      const uses = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (msg.stop_reason !== "tool_use" || uses.length === 0) break;

      messages.push({ role: "assistant", content: msg.content });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        const tool = req.tools.find((t) => t.name === use.name);
        const parsed = tool?.schema.safeParse(use.input);
        if (!tool || !parsed?.success) {
          const error = tool ? `Entrada inválida: ${parsed?.error?.message.slice(0, 300)}` : `Ferramenta desconhecida: ${use.name}`;
          calls.push({ name: use.name, input: use.input, output: null, error });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: error });
          continue;
        }
        try {
          const output = await tool.run(parsed.data);
          calls.push({ name: use.name, input: parsed.data, output });
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output) });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          calls.push({ name: use.name, input: parsed.data, output: null, error });
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: error.slice(0, 500) });
        }
      }
      // Todos os resultados numa única mensagem.
      messages.push({ role: "user", content: results });
    }
    return { text: texts.join("\n\n"), toolCalls: calls, model };
  }

  private checkStop(msg: BetaMessage) {
    if (msg.stop_reason === "refusal") {
      throw new AIError("A IA não pôde atender este pedido por política de segurança. Reformule o pedido.", "recusa");
    }
    if (msg.stop_reason === "max_tokens") {
      throw new AIError("A resposta da IA ficou longa demais e foi cortada. Tente um pedido mais curto.", "limite");
    }
  }
}
