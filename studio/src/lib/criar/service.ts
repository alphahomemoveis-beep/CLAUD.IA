import "server-only";
import { query, queryOne } from "../db";
import { logActivity } from "../activity";
import { log } from "../logger";
import { AppError, notFound } from "../errors";
import { storage } from "../storage";
import { text } from "../ai";
import { AIError } from "../ai/types";
import { effectiveAI, getBrand, type Brand } from "../repo/brand";
import { buildBrandMemory } from "../studio/context";
import { CRIAR_RULES, newRoundRequest, researchRequest } from "./prompts";
import { FORMAT_INFO, OpcoesSchema, type Format, type Opcao } from "./schemas";

export type CreationStatus = "pesquisando" | "opcoes" | "escolhida" | "renderizando" | "pronto" | "falhou";

export interface Background {
  peca: number;
  origem: "upload" | "pasta" | "pexels";
  file_key: string;
  media_type: "image" | "video";
  credito?: string;
  credito_url?: string;
}

export interface Creation {
  id: string;
  brand_id: string;
  created_by: string | null;
  format: Format;
  theme: string;
  status: CreationStatus;
  error: string | null;
  research: { tendencias: Array<{ tendencia: string; evidencia: string; fonte_url: string }>; fontes: Array<{ url: string; title: string }> } | null;
  chosen_option_id: string | null;
  backgrounds: Background[];
  output_media_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface OptionRow {
  id: string;
  round: number;
  number: number;
  request: string;
  data: Opcao;
  chosen: boolean;
}

export class CreationError extends AppError {
  constructor(message: string) {
    super(409, message, "criacao_estado");
  }
}

/** Trabalho que passou disso com o servidor reiniciado no meio é dado como perdido. */
const STALE_MS = 15 * 60_000;

export const getCreation = (id: string, brandId: string) =>
  queryOne<Creation>(`SELECT * FROM content_creations WHERE id = $1 AND brand_id = $2`, [id, brandId]);

export const listOptions = (creationId: string) =>
  query<OptionRow>(`SELECT id, round, number, request, data, chosen FROM content_options WHERE creation_id = $1 ORDER BY round, number`, [creationId]);

export async function chosenOption(c: Creation): Promise<OptionRow | null> {
  if (!c.chosen_option_id) return null;
  return queryOne<OptionRow>(`SELECT id, round, number, request, data, chosen FROM content_options WHERE id = $1`, [c.chosen_option_id]);
}

async function setStatus(id: string, status: CreationStatus, extra: { error?: string | null } = {}) {
  await query(`UPDATE content_creations SET status = $2, error = $3, updated_at = now() WHERE id = $1`, [id, status, extra.error ?? null]);
}

/** Roda em segundo plano; a tela acompanha pelo status. Erros viram mensagem na criação. */
export function background(id: string, label: string, fn: () => Promise<void>) {
  void fn().catch(async (err) => {
    const msg = err instanceof AIError || err instanceof AppError ? err.message : "Algo deu errado. Tente de novo.";
    log.error(label, { id, err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) });
    await setStatus(id, "falhou", { error: msg }).catch(() => undefined);
  });
}

export async function listCreations(brandId: string) {
  return query<Creation & { titulo: string | null }>(
    `SELECT c.*, o.data->>'titulo' AS titulo FROM content_creations c
       LEFT JOIN content_options o ON o.id = c.chosen_option_id
      WHERE c.brand_id = $1 ORDER BY c.created_at DESC LIMIT 30`,
    [brandId],
  );
}

/** A criação como a tela precisa, já corrigindo trabalho perdido num reinício. */
export async function creationView(id: string, brandId: string) {
  let c = await getCreation(id, brandId);
  if (!c) throw notFound("Criação não encontrada.");
  if ((c.status === "pesquisando" || c.status === "renderizando") && Date.now() - new Date(c.updated_at).getTime() > STALE_MS) {
    const back: CreationStatus = c.status === "renderizando" ? "escolhida" : (await listOptions(c.id)).length ? "opcoes" : "falhou";
    await setStatus(c.id, back, { error: "O trabalho foi interrompido (o servidor reiniciou). Tente de novo." });
    c = (await getCreation(id, brandId))!;
  }
  const options = await listOptions(c.id);
  const brand = await getBrand();
  return { creation: c, options, hasLogo: !!brand.logo_file_key };
}

export async function createCreation(brand: Brand, userId: string, format: Format, theme: string) {
  const c = (await queryOne<Creation>(
    `INSERT INTO content_creations (brand_id, created_by, format, theme) VALUES ($1, $2, $3, $4) RETURNING *`,
    [brand.id, userId, format, theme.trim()],
  ))!;
  await logActivity(userId, "criacao_iniciada", "content_creations", c.id, { formato: format });
  background(c.id, "criar_opcoes_falhou", () => generateRound(brand, c, ""));
  return c;
}

/** Pede 3 opções novas. Só quando ninguém escolheu ainda ou a pessoa voltou atrás. */
export async function requestNewRound(brand: Brand, userId: string, id: string, pedido: string) {
  const c = await queryOne<Creation>(
    `UPDATE content_creations SET status = 'pesquisando', error = NULL, updated_at = now()
      WHERE id = $1 AND brand_id = $2 AND status IN ('opcoes', 'escolhida', 'pronto', 'falhou') RETURNING *`,
    [id, brand.id],
  );
  if (!c) throw new CreationError("Espere a IA terminar o que está fazendo.");
  await logActivity(userId, "criacao_novas_opcoes", "content_creations", id, { pedido: pedido.slice(0, 200) });
  background(c.id, "criar_opcoes_falhou", () => generateRound(brand, c, pedido.trim()));
  return c;
}

async function generateRound(brand: Brand, c: Creation, pedido: string) {
  const ai = effectiveAI(brand);
  const previous = await listOptions(c.id);
  const round = (previous.at(-1)?.round ?? 0) + 1;
  const memory = await buildBrandMemory(brand);
  const first = previous.length === 0 || !c.research;
  const ask = first
    ? researchRequest(c.format, c.theme)
    : `${newRoundRequest(c.format, c.theme, previous.map((p) => p.data), pedido)}\n\nTENDÊNCIAS JÁ PESQUISADAS:\n${JSON.stringify(c.research?.tendencias ?? [], null, 1)}`;

  const res = await text().structured({
    schemaName: "opcoes_conteudo",
    schema: OpcoesSchema,
    system: `${memory}\n\n${CRIAR_RULES}`,
    messages: [{ role: "user", text: ask }],
    webSearch: first && ai.webSearch,
    model: ai.textModel,
    effort: "high",
  });
  const [min, max] = FORMAT_INFO[c.format].pecas;
  const options = res.data.opcoes.map((o) => ({ ...o, pecas: o.pecas.slice(0, max) }));
  if (options.some((o) => o.pecas.length < min)) log.warn("criar_poucas_pecas", { id: c.id, min });

  for (const [i, o] of options.entries()) {
    await query(`INSERT INTO content_options (creation_id, round, number, request, data) VALUES ($1, $2, $3, $4, $5)`,
      [c.id, round, i + 1, pedido, JSON.stringify(o)]);
  }
  const research = first
    ? { tendencias: res.data.tendencias, fontes: res.sources.map((s) => ({ url: s.url, title: s.title })) }
    : c.research;
  await query(`UPDATE content_creations SET status = 'opcoes', error = NULL, research = $2, updated_at = now() WHERE id = $1`,
    [c.id, JSON.stringify(research)]);
}

/** A pessoa escolheu. Trocar de opção depois apaga os fundos e o resultado anterior. */
export async function chooseOption(brandId: string, userId: string, id: string, optionId: string) {
  const c = await getCreation(id, brandId);
  if (!c) throw notFound("Criação não encontrada.");
  if (c.status === "pesquisando" || c.status === "renderizando") throw new CreationError("Espere a IA terminar o que está fazendo.");
  const opt = await queryOne<OptionRow>(`SELECT id FROM content_options WHERE id = $1 AND creation_id = $2`, [optionId, id]);
  if (!opt) throw notFound("Opção não encontrada.");
  const same = c.chosen_option_id === optionId;
  await query(`UPDATE content_options SET chosen = (id = $2) WHERE creation_id = $1`, [id, optionId]);
  const status: CreationStatus = c.format === "roteiro" ? "pronto" : same && c.status === "pronto" ? "pronto" : "escolhida";
  await query(
    `UPDATE content_creations SET chosen_option_id = $2, status = $3, error = NULL,
            backgrounds = CASE WHEN $4 THEN backgrounds ELSE '[]'::jsonb END,
            output_media_ids = CASE WHEN $4 THEN output_media_ids ELSE '{}' END, updated_at = now()
      WHERE id = $1`,
    [id, optionId, status, same],
  );
  if (!same) await dropBackgroundFiles(c.backgrounds);
  await logActivity(userId, "criacao_escolhida", "content_creations", id, { opcao: optionId });
}

/** Apaga os arquivos de fundo que foram copiados para a criação (os das Pastas ficam). */
async function dropBackgroundFiles(list: Background[]) {
  for (const b of list) if (b.origem !== "pasta") await storage().remove(b.file_key).catch(() => undefined);
}

/** Troca o fundo de uma peça (ou tira, com null). */
export async function setBackground(brandId: string, id: string, peca: number, bg: Background | null) {
  const c = await getCreation(id, brandId);
  if (!c) throw notFound("Criação não encontrada.");
  if (!["escolhida", "pronto", "falhou"].includes(c.status) || !c.chosen_option_id) throw new CreationError("Escolha uma opção antes dos fundos.");
  const opt = (await chosenOption(c))!;
  if (peca < 0 || peca >= opt.data.pecas.length) throw new CreationError("Essa peça não existe.");
  const old = c.backgrounds.find((b) => b.peca === peca);
  const list = c.backgrounds.filter((b) => b.peca !== peca);
  if (bg) list.push({ ...bg, peca });
  list.sort((a, b) => a.peca - b.peca);
  await query(`UPDATE content_creations SET backgrounds = $2, updated_at = now() WHERE id = $1`, [id, JSON.stringify(list)]);
  if (old) await dropBackgroundFiles([old]);
  return list;
}
