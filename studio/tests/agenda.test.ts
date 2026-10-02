import { describe, expect, it } from "vitest";
import { describeLocal, localToUtc, utcToLocal } from "@/lib/agenda/time";
import { signMediaToken, verifyMediaToken } from "@/lib/social/signing";
import { fullText, metricoolPayload, normalizeHashtags, postProblems } from "@/lib/agenda/rules";

describe("fuso horário", () => {
  it("converte hora de São Paulo para UTC e de volta", () => {
    const utc = localToUtc("2026-10-03T19:00:00", "America/Sao_Paulo");
    expect(utc.toISOString()).toBe("2026-10-03T22:00:00.000Z");
    expect(utcToLocal(utc, "America/Sao_Paulo")).toBe("2026-10-03T19:00:00");
  });
  it("respeita outros fusos e horário de verão", () => {
    expect(localToUtc("2026-07-01T09:30", "Europe/Lisbon").toISOString()).toBe("2026-07-01T08:30:00.000Z");
    expect(localToUtc("2026-01-15T09:30", "Europe/Lisbon").toISOString()).toBe("2026-01-15T09:30:00.000Z");
  });
  it("recusa datas mal formadas", () => {
    expect(() => localToUtc("03/10/2026 19h", "America/Sao_Paulo")).toThrow();
    expect(() => localToUtc("2026-13-01T10:00", "America/Sao_Paulo")).toThrow();
  });
  it("descreve a data em português", () => {
    expect(describeLocal(new Date("2026-10-03T22:00:00Z"), "America/Sao_Paulo")).toMatch(/sábado, 3 de outubro de 2026/);
  });
});

describe("link assinado de mídia", () => {
  const secret = "x".repeat(40);
  it("aceita o link certo dentro do prazo", () => {
    const t = signMediaToken("abc", Date.now() + 60_000, secret);
    expect(verifyMediaToken(t, secret)).toBe("abc");
  });
  it("recusa link vencido, adulterado ou com outra chave", () => {
    const t = signMediaToken("abc", Date.now() - 1000, secret);
    expect(verifyMediaToken(t, secret)).toBeNull();
    const ok = signMediaToken("abc", Date.now() + 60_000, secret);
    const [body, sig] = ok.split(".");
    const forged = Buffer.from(JSON.stringify({ m: "outra", e: 9999999999 })).toString("base64url");
    expect(verifyMediaToken(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifyMediaToken(`${body}.${sig}`, "y".repeat(40))).toBeNull();
    expect(verifyMediaToken("lixo", secret)).toBeNull();
  });
});

describe("regras de post", () => {
  const future = new Date(Date.now() + 86400_000);
  const video = { id: "v", tipo: "video" as const };
  const foto = { id: "f", tipo: "image" as const };
  it("normaliza hashtags sem repetir", () => {
    expect(normalizeHashtags(["moveis planejados", "#Marcenaria", "marcenaria", "#alto-padrão"])).toEqual(["#moveis", "#planejados", "#Marcenaria", "#altopadrão"]);
  });
  it("Reels exige um vídeo; carrossel exige 2 a 10 mídias", () => {
    expect(postProblems({ type: "REEL", media: [foto], caption: "", hashtags: [], networks: ["instagram"], scheduledAt: future })).toContain("Reels precisa de exatamente um vídeo.");
    expect(postProblems({ type: "REEL", media: [video], caption: "", hashtags: [], networks: ["instagram"], scheduledAt: future })).toEqual([]);
    expect(postProblems({ type: "CARROSSEL", media: [foto], caption: "", hashtags: [], networks: ["instagram"], scheduledAt: future })[0]).toMatch(/2 a 10/);
  });
  it("não agenda no passado", () => {
    expect(postProblems({ type: "POST", media: [foto], caption: "", hashtags: [], networks: ["instagram"], scheduledAt: new Date(Date.now() - 1000) }).join()).toMatch(/futuro/);
  });
  it("monta o corpo do Metricool com legenda, hashtags e hora local", () => {
    const body = metricoolPayload({ type: "REEL", networks: ["instagram"], caption: "Cozinha pronta", hashtags: ["#marcenaria"], firstComment: "",
      localDateTime: "2026-10-03T19:00:00", timezone: "America/Sao_Paulo", mediaUrls: ["https://app.exemplo/m.mp4"] });
    expect(body.text).toBe(fullText("Cozinha pronta", ["#marcenaria"]));
    expect(body.publicationDate).toEqual({ dateTime: "2026-10-03T19:00:00", timezone: "America/Sao_Paulo" });
    expect(body.instagramData).toEqual({ type: "REEL", showReelOnFeed: true });
    expect(body.providers).toEqual([{ network: "instagram" }]);
  });
});
