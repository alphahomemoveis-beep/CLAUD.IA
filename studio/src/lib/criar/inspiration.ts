import "server-only";
import { query, queryOne } from "../db";
import { logActivity } from "../activity";
import { AppError } from "../errors";
import { newKey, storage } from "../storage";
import { text } from "../ai";
import { effectiveAI, type Brand } from "../repo/brand";
import { buildBrandMemory } from "../studio/context";
import { CRIAR_RULES } from "./prompts";
import { ReceitaSchema } from "./schemas";
import { analyzeVideo, MAX_SHOTS, type Shot } from "./shots";
import { background, CreationError, type Creation } from "./service";

export interface Inspiration {
  origem: "arquivo" | "youtube";
  file_key?: string;
  url?: string;
  total?: number;
  shots?: Shot[];
  estilo?: string;
  por_que_funciona?: string;
}

/**
 * Link aceito: só YouTube, que o Gemini assiste direto. Instagram e TikTok não
 * deixam aplicativos baixarem vídeos: a pessoa salva o vídeo e envia o arquivo.
 */
export function youtubeUrl(raw: string): string {
  const s = raw.trim();
  if (/instagram\.com|tiktok\.com|kwai|facebook\.com|fb\.watch/i.test(s)) {
    throw new AppError(422, "O Instagram e o TikTok não deixam aplicativos baixarem vídeos pelo link. Salve o vídeo no celular (ou grave a tela) e envie o arquivo aqui.", "link_nao_suportado");
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new AppError(422, "Esse link não parece válido. Cole o link do YouTube ou envie o arquivo do vídeo.", "link_invalido");
  }
  const host = u.hostname.replace(/^(www\.|m\.)/, "");
  const id = host === "youtu.be" ? u.pathname.slice(1)
    : host === "youtube.com" ? (u.searchParams.get("v") ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ?? "")
    : "";
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    throw new AppError(422, "Por link, só funciona vídeo do YouTube. De outros lugares, envie o arquivo do vídeo.", "link_nao_suportado");
  }
  return `https://www.youtube.com/watch?v=${id}`;
}

export async function createFromInspiration(brand: Brand, userId: string, input: { video?: { data: Buffer; mime: string; ext: string }; url?: string; tema: string }) {
  let insp: Inspiration;
  if (input.video) {
    const key = newKey("criacoes", input.video.ext);
    await storage().put(key, input.video.data, input.video.mime);
    insp = { origem: "arquivo", file_key: key };
  } else if (input.url) {
    if (effectiveAI(brand).provider !== "gemini" && effectiveAI(brand).provider !== "mock") {
      throw new AppError(422, "Link do YouTube só funciona com a IA do Gemini. Envie o arquivo do vídeo.", "link_nao_suportado");
    }
    insp = { origem: "youtube", url: youtubeUrl(input.url) };
  } else {
    throw new AppError(400, "Envie o vídeo de inspiração ou cole o link do YouTube.", "requisicao_invalida");
  }
  const c = (await queryOne<Creation>(
    `INSERT INTO content_creations (brand_id, created_by, format, theme, inspiration) VALUES ($1, $2, 'reels', $3, $4) RETURNING *`,
    [brand.id, userId, input.tema.trim(), JSON.stringify(insp)],
  ))!;
  await logActivity(userId, "criacao_inspiracao", "content_creations", c.id, { origem: insp.origem });
  background(c.id, "criar_inspiracao_falhou", () => buildRecipe(brand, c.id, insp, input.tema.trim(), input.video?.data));
  return c;
}

async function buildRecipe(brand: Brand, id: string, insp: Inspiration, tema: string, video?: Buffer) {
  const ai = effectiveAI(brand);
  let frames: Buffer[] = [];
  if (video) {
    let analysis;
    try {
      analysis = await analyzeVideo(video);
    } catch (err) {
      throw new CreationError((err as Error).message);
    }
    frames = analysis.frames;
    insp = { ...insp, total: analysis.total, shots: analysis.shots };
  }
  const shots = insp.shots ?? [];
  const cenas = shots.length
    ? `O vídeo tem ${insp.total} s e ${shots.length} cenas. As fotos anexadas são o meio de cada cena, na ordem:\n${shots.map((s, i) => `CENA ${i + 1}: ${s.duracao} s (de ${s.inicio} a ${s.fim} s)`).join("\n")}\nUse exatamente ${shots.length} peças, uma por cena, com essas durações.`
    : `Assista ao vídeo do link, divida em cenas (no máximo ${MAX_SHOTS}) e use uma peça por cena, com a duração que você observar.`;
  const memory = await buildBrandMemory(brand);
  const res = await text().structured({
    schemaName: "receita_inspiracao",
    schema: ReceitaSchema,
    system: `${memory}\n\n${CRIAR_RULES}`,
    messages: [{
      role: "user",
      text: `A pessoa mandou um vídeo de inspiração e quer um Reels da marca no mesmo molde.
${cenas}
${tema ? `TEMA DA MARCA PARA ESTE VÍDEO: ${tema}` : "Escolha o tema da marca que combina com esse molde."}

1. Descreva o estilo da inspiração: ritmo de cortes, enquadramentos, movimentos de câmera, textos na tela e clima.
2. Monte o vídeo da marca no mesmo ritmo. Em cada cena, diga em "imagem" exatamente o que a marca deve filmar e,
   em "como_filmar", como filmar: enquadramento, ângulo, movimento, luz e a duração do take (um pouco maior que a cena).
3. Os textos na tela seguem o estilo da marca (título grande e apoio em itálico). Não copie textos, marcas nem
   pessoas do vídeo original: use só o molde.`,
    }],
    images: frames.map((data) => ({ mime: "image/jpeg", data })),
    videoUrl: insp.origem === "youtube" ? insp.url : undefined,
    model: ai.visionModel,
    effort: "high",
  });
  const opcao = res.data.opcao;
  // As durações medidas no vídeo valem mais que as estimadas pela IA.
  if (shots.length && opcao.pecas.length === shots.length) {
    opcao.pecas = opcao.pecas.map((p, i) => ({ ...p, duracao_s: Math.max(0.5, Math.min(12, shots[i].duracao)) }));
  }
  const opt = (await queryOne<{ id: string }>(
    `INSERT INTO content_options (creation_id, round, number, request, data, chosen) VALUES ($1, 1, 1, '', $2, true) RETURNING id`,
    [id, JSON.stringify(opcao)],
  ))!;
  await query(
    `UPDATE content_creations SET status = 'escolhida', error = NULL, chosen_option_id = $2, inspiration = $3, updated_at = now() WHERE id = $1`,
    [id, opt.id, JSON.stringify({ ...insp, estilo: res.data.estilo, por_que_funciona: res.data.por_que_funciona })],
  );
}
