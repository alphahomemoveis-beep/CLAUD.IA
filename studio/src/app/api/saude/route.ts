import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { diagnoseDbError } from "../../../../scripts/db-diagnose.mjs";

export const dynamic = "force-dynamic";

/**
 * Saúde do app, sem login: diz se o banco responde e, se não, o que corrigir.
 * Nunca devolve a senha nem o endereço do banco.
 */
export async function GET() {
  const startup = process.env.DB_STARTUP_ERROR;
  try {
    await Promise.race([
      query("SELECT 1 FROM schema_migrations LIMIT 1"),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), 8000)),
    ]);
    return NextResponse.json({ ok: true, banco: "ok" });
  } catch (err) {
    const tablesMissing = /schema_migrations/.test(String((err as Error).message)) && /does not exist|não existe/.test(String((err as Error).message));
    const erro = startup ?? (tablesMissing ? "O banco conecta, mas as tabelas não foram criadas. Confira se o Custom Start Command da Railway é npm run start:prod." : diagnoseDbError(err));
    return NextResponse.json({ ok: false, banco: "erro", erro }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
