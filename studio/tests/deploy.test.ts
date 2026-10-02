import { describe, expect, it } from "vitest";
import { pgConfig } from "@/lib/pg-config";

describe("conexão com o banco em produção", () => {
  const url = "postgresql://postgres.abc:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require";
  it("sem certificado, usa a URL como está", () => {
    expect(pgConfig(url, undefined)).toEqual({ connectionString: url });
  });
  it("com certificado, verifica o servidor e tira o sslmode da URL", () => {
    const cfg = pgConfig(url, "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----");
    expect(cfg.connectionString).not.toMatch(/sslmode/);
    expect(cfg.ssl).toEqual({ ca: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  });
});
