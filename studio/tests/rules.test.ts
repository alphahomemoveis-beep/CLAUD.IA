import { describe, expect, it } from "vitest";
import { detectEnvironments, mixesEnvironments } from "@/lib/studio/environments";
import { parseReply } from "@/lib/studio/intent";
import { assertCanApprovePlan, assertCanChooseConcept, assertCanGenerate } from "@/lib/studio/workflow";
import { enforceResearchHonesty, planProblems } from "@/lib/studio/guards";
import { detectFile } from "@/lib/uploads";
import { checkRate, resetRateLimits } from "@/lib/rate-limit";
import { toStrictJsonSchema } from "@/lib/ai/json-schema";
import { ConceptSetSchema, PlanSchema, type PlanData } from "@/lib/ai/schemas";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("regra absoluta: nunca gerar antes da escolha e da aprovação", () => {
  it("bloqueia geração sem conceito escolhido", () => {
    expect(() => assertCanGenerate({ stage: "conceitos", chosenConceptId: null, approvedPlanId: null })).toThrow(/antes da escolha do conceito/);
  });
  it("bloqueia geração com conceito escolhido mas planejamento não aprovado", () => {
    expect(() => assertCanGenerate({ stage: "planejamento", chosenConceptId: "c", approvedPlanId: null })).toThrow(/aprovação do planejamento/);
  });
  it("bloqueia geração quando o projeto voltou ao planejamento", () => {
    expect(() => assertCanGenerate({ stage: "planejamento", chosenConceptId: "c", approvedPlanId: "p" })).toThrow();
  });
  it("libera geração com conceito escolhido e planejamento aprovado", () => {
    expect(() => assertCanGenerate({ stage: "aprovado", chosenConceptId: "c", approvedPlanId: "p" })).not.toThrow();
  });
  it("não aprova planejamento sem conceito", () => {
    expect(() => assertCanApprovePlan({ stage: "conceitos", chosenConceptId: null, approvedPlanId: null }, false)).toThrow();
  });
  it("não escolhe conceito antes de existirem conceitos nem depois da aprovação", () => {
    expect(() => assertCanChooseConcept({ stage: "briefing", chosenConceptId: null, approvedPlanId: null })).toThrow();
    expect(() => assertCanChooseConcept({ stage: "aprovado", chosenConceptId: "c", approvedPlanId: "p" })).toThrow();
  });
});

describe("um ambiente por arte", () => {
  it("detecta ambientes com e sem acento", () => {
    expect(detectEnvironments("Cozinha integrada à sala de estar")).toEqual(["cozinha", "sala"]);
    expect(detectEnvironments("Escritório em casa")).toEqual(["home office"]);
  });
  it("aponta mistura de ambientes", () => {
    expect(mixesEnvironments("Cozinha planejada")).toBe(false);
    expect(mixesEnvironments("Cozinha e closet")).toBe(true);
  });
  const basePlan = (over: Partial<PlanData>): PlanData => ({
    conceito: "", objetivo: "", ambiente: "Cozinha", cenario: "", paleta: [], materiais: [], produto_protagonista: "", composicao: "",
    enquadramento: "", iluminacao: "", texto: "", logo: "", assinatura: "", referencias_utilizadas: [], formato: "", proporcao: "4:5",
    estrategia_instagram: { objetivo: "", legenda_sugerida: "", cta: "", hashtags: [], melhor_uso: "" },
    pecas: [{ numero: 1, papel: "ARTE", titulo: "", texto_na_arte: "", descricao_visual: "Cozinha com gavetas", enquadramento: "" }],
    roteiro: null, ...over,
  });
  it("reprova planejamento cuja peça mostra outro ambiente", () => {
    const plan = basePlan({ pecas: [{ numero: 1, papel: "ARTE", titulo: "", texto_na_arte: "", descricao_visual: "Closet iluminado", enquadramento: "" }] });
    expect(planProblems(plan, "arte", false).join(" ")).toMatch(/outro ambiente/);
    expect(planProblems(plan, "arte", true)).toEqual([]);
  });
  it("exige roteiro no Reels e 3+ slides no carrossel", () => {
    expect(planProblems(basePlan({}), "reels", false).join(" ")).toMatch(/roteiro/);
    expect(planProblems(basePlan({}), "carrossel", false).join(" ")).toMatch(/3 slides/);
  });
});

describe("tendência atual exige fonte citada", () => {
  const research = {
    resumo: "", formatos_em_alta: [], oportunidades_para_marca: [], cuidados: [], referencias_historicas: [],
    tendencias_atuais: [
      { titulo: "Com fonte", descricao: "", evidencia: "", fonte_url: "https://www.archdaily.com.br/x", data_referencia: "2026" },
      { titulo: "Fonte inventada", descricao: "", evidencia: "", fonte_url: "https://site-nao-citado.com/y", data_referencia: null },
      { titulo: "Sem fonte", descricao: "", evidencia: "", fonte_url: null, data_referencia: null },
    ],
  };
  it("move tendências sem fonte citada para referência histórica", () => {
    const out = enforceResearchHonesty(research, [{ url: "https://archdaily.com.br/outra", title: "ArchDaily" }]);
    expect(out.tendencias_atuais.map((t) => t.titulo)).toEqual(["Com fonte"]);
    expect(out.referencias_historicas.map((t) => t.titulo)).toEqual(["Fonte inventada", "Sem fonte"]);
  });
  it("sem nenhuma citação, nada conta como tendência atual", () => {
    expect(enforceResearchHonesty(research, []).tendencias_atuais).toEqual([]);
  });
});

describe("leitura das respostas", () => {
  it.each([["Conceito 2.", 2], ["conceito 02", 2], ["quero o 3", 3], ["o segundo", 2], ["opção 5", 5], ["4", 4]])("%s escolhe o conceito %i", (t, n) => {
    expect(parseReply(t)).toEqual({ kind: "choose", number: n });
  });
  it.each(["Aprovado", "pode gerar!", "sim", "Aprovar planejamento."])("%s aprova", (t) => {
    expect(parseReply(t)).toEqual({ kind: "approve" });
  });
  it.each(["sim, mas troque a paleta", "Conceito 2 mas com closet", "não gostei", "aprovado, só que mais claro"])("%s não é aprovação nem escolha direta", (t) => {
    expect(parseReply(t)).toEqual({ kind: "unknown" });
  });
});

describe("uploads", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  it("reconhece pelo conteúdo, não pela extensão", () => {
    expect(detectFile(bytes(0xff, 0xd8, 0xff))?.mime).toBe("image/jpeg");
    expect(detectFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe("image/png");
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(detectFile(webp)?.mime).toBe("image/webp");
    const mp4 = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypisom"), 0, 0, 0, 0]);
    expect(detectFile(mp4)?.kind).toBe("video");
  });
  it("recusa HTML, SVG e executáveis", () => {
    expect(detectFile(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectFile(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectFile(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
  });
});

describe("limite de requisições", () => {
  it("bloqueia depois do limite e libera depois da janela", () => {
    resetRateLimits();
    const rule = { limit: 2, windowMs: 1000 };
    expect(checkRate("k", rule, 0).ok).toBe(true);
    expect(checkRate("k", rule, 10).ok).toBe(true);
    expect(checkRate("k", rule, 20).ok).toBe(false);
    expect(checkRate("k", rule, 1500).ok).toBe(true);
  });
});

describe("saída estruturada", () => {
  it("gera JSON Schema estrito sem palavras-chave recusáveis", () => {
    for (const schema of [ConceptSetSchema, PlanSchema]) {
      const js = JSON.stringify(toStrictJsonSchema(schema));
      expect(js).not.toMatch(/minItems|maxItems|\$schema/);
      expect(js).toMatch(/"additionalProperties":false/);
    }
  });
  it("valida a quantidade de conceitos mesmo sem minItems no esquema enviado", () => {
    expect(ConceptSetSchema.safeParse({ introducao: "", recomendacao: "", conceitos: [] }).success).toBe(false);
  });
});

describe("senhas", () => {
  it("guarda hash scrypt e confere", async () => {
    const h = await hashPassword("senhaForte123");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("senhaForte123", h)).toBe(true);
    expect(await verifyPassword("errada", h)).toBe(false);
  });
});
