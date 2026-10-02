import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { log } from "./logger";
import { AIError } from "./ai/types";

export class AppError extends Error {
  constructor(public status: number, message: string, public code = "erro") {
    super(message);
  }
}

export const badRequest = (msg: string) => new AppError(400, msg, "requisicao_invalida");
export const unauthorized = (msg = "Faça login para continuar.") => new AppError(401, msg, "nao_autenticado");
export const forbidden = (msg = "Você não tem permissão para esta ação.") => new AppError(403, msg, "sem_permissao");
export const notFound = (msg = "Não encontrado.") => new AppError(404, msg, "nao_encontrado");
export const conflict = (msg: string) => new AppError(409, msg, "conflito");

/** Converte qualquer erro numa resposta JSON sem vazar detalhes internos. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof AIError) {
    const status = err.kind === "indisponivel" ? 503 : err.kind === "recusa" ? 422 : 502;
    return NextResponse.json({ error: err.message, code: `ia_${err.kind}` }, { status });
  }
  if (err instanceof ZodError) {
    const detail = err.issues.map((i) => `${i.path.join(".") || "campo"}: ${i.message}`).join("; ");
    return NextResponse.json({ error: `Dados inválidos. ${detail}`, code: "dados_invalidos" }, { status: 400 });
  }
  const id = crypto.randomUUID().slice(0, 8);
  log.error("erro_nao_tratado", { id, err });
  return NextResponse.json(
    { error: `Algo deu errado do nosso lado. Código do erro: ${id}.`, code: "erro_interno" },
    { status: 500 },
  );
}
