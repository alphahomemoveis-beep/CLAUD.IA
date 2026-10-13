import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { GeminiProvider } from "@/lib/ai/gemini-provider";
import { MockText } from "@/lib/ai/mock-provider";
import { OpcoesSchema } from "@/lib/criar/schemas";
import { FORMAT_INFO, FORMATS } from "@/lib/criar/formats";
import { formatBrief, newRoundRequest, researchRequest } from "@/lib/criar/prompts";
import { brandHandle, overlayPng, titleSize } from "@/lib/criar/render";
import { downloadStock, pickPixabayVideo, pickVideoFile, searchStock, stockSource } from "@/lib/criar/stock";
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

  it("manda a chave nova (AQ.) no cabeçalho, nunca na URL", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as Record<string, string> }); return textResp("{}"); }));
    await new GeminiProvider("AQ.chave-nova").structured({ schemaName: "x", schema: z.object({}), system: "", messages: [{ role: "user", text: "a" }], model: "m" });
    expect(seen[0].url).not.toContain("key=");
    expect(seen[0].headers["x-goog-api-key"]).toBe("AQ.chave-nova");
  });

  /** Sem esperas de verdade nos testes. */
  class FastGemini extends GeminiProvider { protected sleep() { return Promise.resolve(); } }
  const ask = (g: GeminiProvider, webSearch = false) =>
    g.structured({ schemaName: "x", schema: z.object({ nome: z.string() }), system: "", messages: [{ role: "user", text: "a" }], model: "gemini-flash-latest", webSearch });

  it("chave recusada (401) e projeto sem faixa grátis viram mensagens claras", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ACCESS_TOKEN_TYPE_UNSUPPORTED", { status: 401 })));
    await expect(ask(new FastGemini("k"))).rejects.toThrow(/Crie uma chave nova/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Quota exceeded, limit: 0", { status: 429 })));
    await expect(ask(new FastGemini("k"))).rejects.toThrow(/faixa gratuita para o projeto/);
  });

  it("modelo cheio (503): tenta de novo e passa para o modelo leve", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      urls.push(u);
      return u.includes("flash-lite") ? textResp(JSON.stringify({ nome: "ok" })) : new Response('{"error":{"code":503,"status":"UNAVAILABLE"}}', { status: 503 });
    }));
    const r = await ask(new FastGemini("k"));
    expect(r.data).toEqual({ nome: "ok" });
    expect(urls.filter((u) => u.includes("gemini-flash-latest"))).toHaveLength(3);
    expect(urls.at(-1)).toContain("gemini-flash-lite-latest");
  });

  it("limite por minuto espera o tempo pedido pelo Google e tenta de novo", async () => {
    let n = 0;
    const g = new FastGemini("k");
    const slept: number[] = [];
    (g as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async (ms) => { slept.push(ms); };
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1
      ? new Response('{"error":{"code":429,"details":[{"retryDelay":"12s"}]}}', { status: 429 })
      : textResp(JSON.stringify({ nome: "ok" })))));
    expect((await ask(g)).data).toEqual({ nome: "ok" });
    expect(slept).toEqual([12500]);
  });

  it("cota do dia acabada em todos os modelos vira mensagem clara", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":429,"message":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}', { status: 429 })));
    await expect(ask(new FastGemini("k"))).rejects.toThrow(/cota grátis de hoje/);
  });

  it("sem cota para a pesquisa, responde assim mesmo sem pesquisa", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (body.tools) return new Response('{"error":{"code":429,"message":"PerDay"}}', { status: 429 });
      return textResp(JSON.stringify({ nome: "sem pesquisa" }));
    }));
    const r = await ask(new FastGemini("k"), true);
    expect(r.data).toEqual({ nome: "sem pesquisa" });
    expect(JSON.stringify(bodies.at(-1))).toContain("pesquisa na web não está disponível");
  });

  it("limite gratuito esgotado vira mensagem clara", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    await expect(ask(new FastGemini("k"))).rejects.toThrow(/pedidos demais seguidos/);
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
    const png = await overlayPng({ w: 1080, h: 1350, peca: { titulo: "2º ponto", apoio: "fita de LED", texto: "Acende ao abrir.", fala: "", imagem: "", busca_imagem: "", duracao_s: 0, como_filmar: "" }, index: 1, total: 5, format: "carrossel", handle: "alphahome.moveis" });
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

describe("criar conteúdo: Pixabay", () => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.PIXABAY_API_KEY = "chave-pixabay";
  const img = { id: 7, pageURL: "https://pixabay.com/photos/cozinha-7/", previewURL: "https://cdn.pixabay.com/p.jpg", webformatURL: "https://pixabay.com/get/w.jpg",
    largeImageURL: "https://pixabay.com/get/l.jpg", imageWidth: 4000, imageHeight: 6000, user: "Ana", user_id: 12 };

  it("o Pixabay tem prioridade quando há chave", () => expect(stockSource()).toBe("pixabay"));

  it("busca fotos verticais e devolve o crédito do autor", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { urls.push(u); return ok({ hits: [img] }); }));
    const r = await searchStock("cozinha madeira", "foto");
    expect(r[0]).toMatchObject({ id: 7, tipo: "foto", autor: "Ana", autor_url: "https://pixabay.com/users/Ana-12/", pagina: img.pageURL });
    const q = new URL(urls[0]).searchParams;
    expect([q.get("key"), q.get("q"), q.get("orientation"), q.get("image_type")]).toEqual(["chave-pixabay", "cozinha madeira", "vertical", "photo"]);
  });

  it("baixa pelo id, só de endereços do Pixabay", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.includes("/api/") ? ok({ hits: [img] }) : new Response(new Uint8Array([1, 2, 3])))));
    const r = await downloadStock(7, "foto");
    expect([r.source, r.data.length]).toEqual(["pixabay", 3]);
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.includes("/api/") ? ok({ hits: [{ ...img, largeImageURL: "https://malicioso.example/x.jpg" }] }) : new Response("x"))));
    await expect(downloadStock(7, "foto")).rejects.toThrow(/inesperado/);
  });

  it("escolhe o maior vídeo que não passe de 4K", () => {
    const v = (w: number, h: number, url: string) => ({ url, width: w, height: h, size: 1 });
    expect(pickPixabayVideo({ large: v(4096, 2160, "4k+"), medium: v(1920, 1080, "hd"), small: v(1280, 720, "s"), tiny: v(960, 540, "t") })?.url).toBe("hd");
    expect(pickPixabayVideo({ large: v(3840, 2160, "4k"), medium: v(1920, 1080, "hd"), small: v(1280, 720, "s"), tiny: v(960, 540, "t") })?.url).toBe("4k");
  });
});
