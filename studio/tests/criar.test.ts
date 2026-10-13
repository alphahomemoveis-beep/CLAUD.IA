import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { GeminiProvider } from "@/lib/ai/gemini-provider";
import { MockText } from "@/lib/ai/mock-provider";
import { OpcoesSchema } from "@/lib/criar/schemas";
import { FORMAT_INFO, FORMATS } from "@/lib/criar/formats";
import { formatBrief, newRoundRequest, researchRequest } from "@/lib/criar/prompts";
import { brandHandle, overlayPng, titleSize } from "@/lib/criar/render";
import { pickVideoFile } from "@/lib/criar/pexels";
import sharp from "sharp";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const textResp = (text: string, extra: Record<string, unknown> = {}) => ok({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", ...extra }], modelVersion: "gemini-x" });

afterEach(() => vi.unstubAllGlobals());

describe("Gemini (opção gratuita)", () => {
  it("pesquisa no Google e depois devolve o JSON validado, com as fontes", async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      if (body.tools) return textResp("Carrosséis de lista estão em alta.", { groundingMetadata: { groundingChunks: [{ web: { uri: "https://exemplo.com/a", title: "Exemplo" } }] } });
      return textResp(JSON.stringify({ nome: "ok" }));
    }));
    const g = new GeminiProvider("chave");
    const r = await g.structured({ schemaName: "x", schema: z.object({ nome: z.string() }), system: "s", messages: [{ role: "user", text: "oi" }], webSearch: true, model: "gemini-flash-latest" });
    expect(r.data).toEqual({ nome: "ok" });
    expect(r.sources).toEqual([{ url: "https://exemplo.com/a", title: "Exemplo", page_age: null }]);
    expect(calls).toHaveLength(2);
    expect(calls[0].tools).toEqual([{ google_search: {} }]);
    expect((calls[1].generationConfig as Record<string, unknown>).responseMimeType).toBe("application/json");
    expect(JSON.stringify(calls[1].generationConfig)).not.toContain("additionalProperties");
  });

  it("executa as ferramentas do app e devolve a resposta final", async () => {
    let step = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      step++;
      if (step === 1) return ok({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "somar", args: { a: 2, b: 3 } }, thoughtSignature: "abc" }] } }] });
      return textResp("Deu 5.");
    }));
    const run = vi.fn(async (i: unknown) => ({ total: (i as { a: number; b: number }).a + (i as { a: number; b: number }).b }));
    const r = await new GeminiProvider("k").agent({ system: "s", messages: [{ role: "user", text: "2+3" }], model: "m",
      tools: [{ name: "somar", description: "soma", schema: z.object({ a: z.number(), b: z.number() }), run }] });
    expect(run).toHaveBeenCalledWith({ a: 2, b: 3 });
    expect(r.text).toBe("Deu 5.");
    expect(r.toolCalls[0]).toMatchObject({ name: "somar", output: { total: 5 } });
  });

  it("limite gratuito esgotado vira mensagem clara", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    const p = new GeminiProvider("k").structured({ schemaName: "x", schema: z.object({}), system: "", messages: [{ role: "user", text: "a" }], model: "m" });
    const expectation = expect(p).rejects.toThrow(/limite gratuito/);
    await vi.runAllTimersAsync();
    await expectation;
    vi.useRealTimers();
  });
});

describe("criar conteúdo: opções", () => {
  it("cada formato pede a quantidade certa de peças", () => {
    expect(formatBrief("feed")).toContain("exatamente 1 peça");
    expect(formatBrief("carrossel")).toContain("de 4 a 8 peças");
    expect(researchRequest("reels", "")).toContain("viral no Instagram");
  });
  it("uma nova rodada lista as opções anteriores e o pedido da pessoa", () => {
    const anterior = { titulo: "5 elementos", formato_viral: "Lista", gancho: "G" } as never;
    const t = newRoundRequest("reels", "", [anterior], "mais curto");
    expect(t).toContain('1. "5 elementos"');
    expect(t).toContain("mais curto");
  });
  it("o provedor de teste traz 3 opções válidas para todos os formatos", async () => {
    for (const f of FORMATS) {
      const r = await new MockText().structured({ schemaName: "opcoes_conteudo", schema: OpcoesSchema, system: "", messages: [{ role: "user", text: researchRequest(f, "") }], model: "mock" });
      expect(r.data.opcoes).toHaveLength(3);
      const [min, max] = FORMAT_INFO[f].pecas;
      for (const o of r.data.opcoes) expect(o.pecas.length).toBeGreaterThanOrEqual(min), expect(o.pecas.length).toBeLessThanOrEqual(max);
    }
  });
  it("o esquema recusa duas opções em vez de três", () => {
    expect(OpcoesSchema.safeParse({ tendencias: [], opcoes: [] }).success).toBe(false);
  });
});

describe("criar conteúdo: artes", () => {
  it("o título diminui com palavras longas e nunca passa do limite", () => {
    expect(titleSize("vive", 930, 200)).toBe(200);
    expect(titleSize("marcenaria planejada", 930, 200)).toBeLessThan(140);
    expect(titleSize("x".repeat(80), 930, 200)).toBeGreaterThanOrEqual(56);
  });
  it("a assinatura usa o @ da marca, sem link", () => {
    expect(brandHandle({ integrations: { instagram_handle: "@alphahome.moveis" } })).toBe("alphahome.moveis");
    expect(brandHandle({ identity: { instagram: "https://www.instagram.com/alphahome.moveis/" } })).toBe("alphahome.moveis");
    expect(brandHandle({})).toBe("alphahome.moveis");
  });
  it("a camada de texto sai transparente e no tamanho do formato", async () => {
    const png = await overlayPng({ w: 1080, h: 1350, peca: { titulo: "2º ponto", apoio: "fita de LED", texto: "Acende ao abrir.", fala: "", imagem: "", busca_imagem: "", duracao_s: 0 }, index: 1, total: 5, format: "carrossel", handle: "alphahome.moveis" });
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([1080, 1350, true]);
  });
  it("do Pexels, escolhe o MP4 vertical mais perto de 1920", () => {
    const f = pickVideoFile([
      { quality: "sd", file_type: "video/mp4", width: 540, height: 960, link: "a" },
      { quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "b" },
      { quality: "uhd", file_type: "video/mp4", width: 2160, height: 3840, link: "c" },
    ]);
    expect(f?.link).toBe("b");
  });
});
