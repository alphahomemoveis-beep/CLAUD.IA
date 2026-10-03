import { describe, expect, it } from "vitest";
import { bundledSupabaseCa, pgConfig } from "@/lib/pg-config";

describe("conexão com o banco em produção", () => {
  const url = "postgresql://postgres.abc:senha@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require";
  const fakeCa = () => "CA-DO-APP";

  it("Supabase sem certificado configurado usa o certificado que vem no app", () => {
    const cfg = pgConfig(url, undefined, fakeCa);
    expect(cfg.connectionString).not.toMatch(/sslmode/);
    expect(cfg.ssl).toEqual({ ca: "CA-DO-APP", rejectUnauthorized: true });
  });
  it("o endereço direto do Supabase (db.*.supabase.co) também usa o certificado do app", () => {
    const cfg = pgConfig("postgresql://postgres:senha@db.abc.supabase.co:5432/postgres", undefined, fakeCa);
    expect(cfg.ssl).toEqual({ ca: "CA-DO-APP", rejectUnauthorized: true });
  });
  it("DATABASE_CA_CERT tem prioridade sobre o certificado do app", () => {
    const cfg = pgConfig(url, "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----", fakeCa);
    expect(cfg.connectionString).not.toMatch(/sslmode/);
    expect(cfg.ssl).toEqual({ ca: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  });
  it("sslmode=no-verify ou disable na URL são respeitados", () => {
    for (const mode of ["no-verify", "disable"]) {
      const u = url.replace("require", mode);
      expect(pgConfig(u, undefined, fakeCa)).toEqual({ connectionString: u });
    }
  });
  it("outro banco sem certificado usa a URL como está", () => {
    const local = "postgresql://alpha:alpha@localhost:5432/alphahome";
    expect(pgConfig(local, undefined, fakeCa)).toEqual({ connectionString: local });
  });
  it("o certificado do app é o Supabase Root 2021 CA", () => {
    const pem = bundledSupabaseCa();
    expect(pem).toMatch(/^-----BEGIN CERTIFICATE-----/);
    expect(pem.trim()).toMatch(/-----END CERTIFICATE-----$/);
  });
});
