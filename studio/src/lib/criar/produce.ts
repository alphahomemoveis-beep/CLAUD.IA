import "server-only";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { query, queryOne } from "../db";
import { logActivity } from "../activity";
import { AppError, notFound } from "../errors";
import { newKey, storage } from "../storage";
import type { Brand } from "../repo/brand";
import { FORMAT_INFO, type Peca } from "./schemas";
import { brandBackground, brandHandle, composeStill, coverImage, endCardPng, ffmpegPath, logoDataUri, overlayPng, renderReel, SIZE, type Scene } from "./render";
import { downloadStock, pexelsEnabled, searchStock } from "./pexels";
import { background, chosenOption, CreationError, getCreation, setBackground, type Background, type Creation } from "./service";

const ROOT_FOLDER = "Criações do app";

/** Um quadro do vídeo, para usar um vídeo como fundo de arte parada. */
async function videoFrame(data: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frame-"));
  try {
    await writeFile(path.join(dir, "in.mp4"), data);
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", "in.mp4", "-frames:v", "1", "out.jpg"], { cwd: dir });
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("Não consegui tirar um quadro do vídeo de fundo."))));
    });
    return await readFile(path.join(dir, "out.jpg"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Pasta raiz "Criações do app" e uma subpasta por criação. */
async function outputFolder(brandId: string, userId: string, c: Creation, title: string) {
  await query(`INSERT INTO folders (brand_id, parent_id, name, description, created_by) VALUES ($1, NULL, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [brandId, ROOT_FOLDER, "Artes e vídeos montados na tela Criar conteúdo.", userId]);
  const root = (await queryOne<{ id: string }>(`SELECT id FROM folders WHERE brand_id = $1 AND parent_id IS NULL AND lower(name) = lower($2)`, [brandId, ROOT_FOLDER]))!;
  const d = new Date(c.created_at);
  const name = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${FORMAT_INFO[c.format].label}: ${title}`.slice(0, 110) + ` #${c.id.slice(0, 4)}`;
  await query(`INSERT INTO folders (brand_id, parent_id, name, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [brandId, root.id, name, userId]);
  return (await queryOne<{ id: string }>(`SELECT id FROM folders WHERE brand_id = $1 AND parent_id = $2 AND lower(name) = lower($3)`, [brandId, root.id, name]))!.id;
}

async function loadBackground(bg: Background | undefined): Promise<{ kind: "image" | "video"; data: Buffer } | null> {
  if (!bg) return null;
  const data = await storage().get(bg.file_key);
  if (!data) throw new AppError(422, `O fundo da peça ${bg.peca + 1} não foi encontrado (talvez tenha sido apagado das Pastas). Escolha outro.`, "fundo_sumiu");
  return { kind: bg.media_type, data };
}

export async function startRender(brand: Brand, userId: string, id: string) {
  const c = await queryOne<Creation>(
    `UPDATE content_creations SET status = 'renderizando', error = NULL, updated_at = now()
      WHERE id = $1 AND brand_id = $2 AND status IN ('escolhida', 'pronto', 'falhou') AND chosen_option_id IS NOT NULL AND format <> 'roteiro'
      RETURNING *`,
    [id, brand.id],
  );
  if (!c) throw new CreationError("Escolha uma opção antes de gerar (e espere o que estiver em andamento).");
  await logActivity(userId, "criacao_gerada", "content_creations", id, { formato: c.format });
  background(c.id, "criar_render_falhou", () => produce(brand, userId, c));
  return c;
}

async function produce(brand: Brand, userId: string, c: Creation) {
  const opt = await chosenOption(c);
  if (!opt) throw new CreationError("A opção escolhida sumiu. Escolha de novo.");
  const info = FORMAT_INFO[c.format];
  const { w, h } = SIZE[info.ratio ?? "4:5"];
  const handle = brandHandle(brand);
  const logo = await logoDataUri(brand.logo_file_key ? await storage().get(brand.logo_file_key) : null);
  const pecas = opt.data.pecas;
  const outputs: Array<{ data: Buffer; ext: "jpg" | "mp4"; mime: string; kind: "image" | "video"; caption: string }> = [];

  if (c.format === "reels") {
    const scenes: Scene[] = [];
    let lastImage: Buffer | null = null;
    for (const [i, p] of pecas.entries()) {
      const bg = await loadBackground(c.backgrounds.find((b) => b.peca === i));
      const still = bg?.kind === "image" ? await coverImage(bg.data, w, h) : null;
      if (still) lastImage = still;
      scenes.push({
        bg: bg?.kind === "video" ? { kind: "video", data: bg.data } : { kind: "image", data: still ?? (await brandBackground(w, h, i)) },
        overlay: await overlayPng({ w, h, peca: p, index: i, total: pecas.length, format: c.format, handle, logo, video: true }),
        seconds: p.duracao_s || 3.5,
      });
    }
    const end = { bg: lastImage ?? (await brandBackground(w, h, 1)), overlay: await endCardPng(w, h, handle, logo) };
    outputs.push({ data: await renderReel(scenes, end, w, h), ext: "mp4", mime: "video/mp4", kind: "video", caption: opt.data.titulo });
  } else {
    for (const [i, p] of pecas.entries()) {
      const bg = await loadBackground(c.backgrounds.find((b) => b.peca === i));
      const base = bg ? await coverImage(bg.kind === "video" ? await videoFrame(bg.data) : bg.data, w, h) : await brandBackground(w, h, i);
      const overlay = await overlayPng({ w, h, peca: p, index: i, total: pecas.length, format: c.format, handle, logo });
      outputs.push({ data: await composeStill(base, overlay), ext: "jpg", mime: "image/jpeg", kind: "image", caption: `${opt.data.titulo} (${i + 1}/${pecas.length})` });
    }
  }

  const folderId = await outputFolder(brand.id, userId, c, opt.data.titulo);
  const ids: string[] = [];
  for (const [i, o] of outputs.entries()) {
    const key = newKey("criacoes", o.ext);
    await storage().put(key, o.data, o.mime);
    const row = (await queryOne<{ id: string }>(
      `INSERT INTO folder_media (brand_id, folder_id, stage, media_type, mime_type, file_key, file_size, original_name, caption, created_by)
       VALUES ($1, $2, 'resultado', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [brand.id, folderId, o.kind, o.mime, key, o.data.length, `${c.format}-${i + 1}.${o.ext}`, o.caption.slice(0, 300), userId],
    ))!;
    ids.push(row.id);
  }
  await query(`UPDATE content_creations SET status = 'pronto', error = NULL, output_media_ids = $2, updated_at = now() WHERE id = $1`, [c.id, ids]);
}

/** Salva um arquivo como fundo de uma peça. */
export async function storeBackground(brandId: string, id: string, peca: number, data: Buffer, mime: string, kind: "image" | "video", extra: Partial<Background> & { origem: Background["origem"] }) {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : kind === "video" ? (mime === "video/quicktime" ? "mov" : mime === "video/webm" ? "webm" : "mp4") : "jpg";
  const key = newKey("criacoes", ext);
  await storage().put(key, data, mime);
  return setBackground(brandId, id, peca, { peca, file_key: key, media_type: kind, ...extra });
}

export async function backgroundFromPexels(brandId: string, id: string, peca: number, pexelsId: number, tipo: "foto" | "video") {
  const { data, item } = await downloadStock(pexelsId, tipo);
  return storeBackground(brandId, id, peca, data, tipo === "video" ? "video/mp4" : "image/jpeg", tipo === "video" ? "video" : "image", {
    origem: "pexels", credito: `${item.autor} no Pexels`, credito_url: item.pagina,
  });
}

/** Completa as peças sem fundo com a primeira foto do Pexels para a busca sugerida pela IA. */
export async function autoBackgrounds(brandId: string, id: string) {
  if (!pexelsEnabled()) throw new AppError(503, "Para buscar fotos sozinho, cadastre PEXELS_API_KEY (grátis em pexels.com/api). Ou envie suas fotos, ou gere com o fundo da marca.", "pexels_desligado");
  const c = await getCreation(id, brandId);
  if (!c) throw notFound("Criação não encontrada.");
  const opt = await chosenOption(c);
  if (!opt) throw new CreationError("Escolha uma opção antes dos fundos.");
  const used = new Set<string>();
  let list = c.backgrounds;
  for (const [i, p] of opt.data.pecas.entries()) {
    if (list.some((b) => b.peca === i)) continue;
    const found = await searchStock(queryFor(p), "foto");
    const pick = found.find((f) => !used.has(f.pagina));
    if (!pick) continue;
    used.add(pick.pagina);
    list = await backgroundFromPexels(brandId, id, i, pick.id, "foto");
  }
  return list;
}

export const queryFor = (p: Peca) => p.busca_imagem.trim() || "luxury wood interior";
