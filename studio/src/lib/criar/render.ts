import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import type { Format, Peca } from "./schemas";

/** Tamanho final de cada formato no Instagram. */
export const SIZE: Record<"4:5" | "9:16", { w: number; h: number }> = {
  "4:5": { w: 1080, h: 1350 },
  "9:16": { w: 1080, h: 1920 },
};

type Node = { type: string; props: Record<string, unknown> };
type Child = Node | string | null | false;
const h = (type: string, style: Record<string, unknown>, ...children: Child[]): Node => {
  const kids = children.filter((c): c is Node | string => !!c);
  return { type, props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
};
const img = (src: string, style: Record<string, unknown>): Node => ({ type: "img", props: { src, style } });

let fonts: Parameters<typeof satori>[1]["fonts"] | null = null;
function loadFonts() {
  if (fonts) return fonts;
  const f = (file: string) => readFileSync(path.join(process.cwd(), "assets", "fonts", file));
  fonts = [
    { name: "Montserrat", data: f("montserrat-latin-300-normal.woff"), weight: 300, style: "normal" },
    { name: "Montserrat", data: f("montserrat-latin-500-normal.woff"), weight: 500, style: "normal" },
    { name: "Montserrat", data: f("montserrat-latin-800-normal.woff"), weight: 800, style: "normal" },
    { name: "Montserrat", data: f("montserrat-latin-300-italic.woff"), weight: 300, style: "italic" },
    { name: "Cormorant", data: f("cormorant-garamond-latin-500-italic.woff"), weight: 500, style: "italic" },
    { name: "Cormorant", data: f("cormorant-garamond-latin-600-italic.woff"), weight: 600, style: "italic" },
  ];
  return fonts;
}

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/** Ícone do Instagram: contorno branco (assinatura) ou colorido (encerramento). */
export function instagramIcon(colored: boolean) {
  const fill = colored
    ? `<defs><radialGradient id="g" cx="0.3" cy="1.07" r="1.3"><stop offset="0" stop-color="#fdf497"/><stop offset="0.1" stop-color="#fdf497"/><stop offset="0.5" stop-color="#fd5949"/><stop offset="0.68" stop-color="#d6249f"/><stop offset="1" stop-color="#285AEB"/></radialGradient></defs><rect width="100" height="100" rx="26" fill="url(#g)"/>`
    : "";
  const stroke = "#fff";
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${fill}
<rect x="${colored ? 20 : 8}" y="${colored ? 20 : 8}" width="${colored ? 60 : 84}" height="${colored ? 60 : 84}" rx="${colored ? 17 : 24}" fill="none" stroke="${stroke}" stroke-width="${colored ? 7 : 9}"/>
<circle cx="50" cy="50" r="${colored ? 14 : 20}" fill="none" stroke="${stroke}" stroke-width="${colored ? 7 : 9}"/>
<circle cx="${colored ? 66 : 73}" cy="${colored ? 34 : 27}" r="${colored ? 4.5 : 6}" fill="${stroke}"/></svg>`);
}

/** Tamanho do título para caber sem cortar: palavra mais longa e texto total. */
export function titleSize(title: string, width: number, max: number) {
  const words = title.trim().split(/\s+/);
  const longest = Math.max(...words.map((w) => w.length), 1);
  const byWord = (width * 0.9) / (longest * 0.66);
  const total = title.length;
  const byTotal = total > 34 ? max * 0.5 : total > 22 ? max * 0.66 : total > 12 ? max * 0.82 : max;
  return Math.round(Math.max(56, Math.min(max, byWord, byTotal)));
}

export interface OverlayInput {
  w: number;
  h: number;
  peca: Peca;
  index: number;
  total: number;
  format: Format;
  handle: string;
  logo?: string | null;
  /** No vídeo a legenda fica no centro; nas artes, embaixo. */
  video?: boolean;
}

/** Camada transparente com textos, logo e assinatura, no estilo da marca. */
export async function overlayPng(o: OverlayInput): Promise<Buffer> {
  const pad = Math.round(o.w * 0.075);
  const max = o.h > 1500 ? 200 : 170;
  const tSize = titleSize(o.peca.titulo, o.w - pad * 2, max);
  const showCount = o.format === "carrossel" && o.total > 1;
  const story = o.h > 1500 && !o.video;

  const signature = h("div", { alignItems: "center", gap: 12 },
    img(instagramIcon(false), { width: 30, height: 30 }),
    h("div", { color: "#fff", fontFamily: "Montserrat", fontWeight: 500, fontSize: 22, letterSpacing: 2.5 }, o.handle.toUpperCase()),
  );
  const top = h("div", { position: "absolute", top: story ? 150 : pad * 0.8, left: pad, right: pad, justifyContent: "space-between", alignItems: "center" },
    o.logo ? img(o.logo, { height: 64, maxWidth: 260, objectFit: "contain" }) : h("div", {}, ""),
    signature,
  );

  const apoio = o.peca.apoio.trim();
  const texto = o.peca.texto.trim();
  const titleBlock = h("div", { flexDirection: "column", alignItems: o.video ? "center" : "flex-start" },
    apoio && h("div", { fontFamily: "Cormorant", fontStyle: "italic", fontWeight: 500, fontSize: Math.round(tSize * 0.42), color: "#f3e3c8", marginBottom: 6, textAlign: o.video ? "center" : "left" }, apoio),
    h("div", {
      fontFamily: "Montserrat", fontWeight: 800, fontSize: tSize, lineHeight: 0.98, letterSpacing: -tSize * 0.035, color: "#fff",
      textAlign: o.video ? "center" : "left", flexWrap: "wrap", justifyContent: o.video ? "center" : "flex-start",
    }, o.peca.titulo.trim()),
    texto && !o.video && h("div", { fontFamily: "Montserrat", fontWeight: 300, fontSize: o.h > 1500 ? 40 : 36, lineHeight: 1.35, color: "#fff", marginTop: 26, maxWidth: o.w - pad * 2 }, texto),
  );

  const body = o.video
    ? h("div", { position: "absolute", left: pad, right: pad, top: Math.round(o.h * 0.56), justifyContent: "center" }, titleBlock)
    : h("div", { position: "absolute", left: pad, right: pad, bottom: story ? 300 : pad * 1.3, flexDirection: "column" }, titleBlock);

  const count = showCount && h("div", { position: "absolute", right: pad, bottom: pad * 0.55, color: "rgba(255,255,255,0.8)", fontFamily: "Montserrat", fontWeight: 500, fontSize: 22, letterSpacing: 2 },
    `${o.index + 1}/${o.total}`);
  const arrow = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 16"><path d="M1 8h36M30 2l7 6-7 6" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="2.4"/></svg>`);
  const swipe = showCount && o.index === 0 && h("div", { position: "absolute", left: pad, bottom: pad * 0.55, alignItems: "center", gap: 12, color: "rgba(255,255,255,0.8)", fontFamily: "Montserrat", fontWeight: 500, fontSize: 22, letterSpacing: 2 },
    "ARRASTE", img(arrow, { width: 40, height: 16 }));

  const shade = h("div", {
    position: "absolute", left: 0, top: 0, width: o.w, height: o.h,
    backgroundImage: o.video
      ? "linear-gradient(180deg, rgba(14,10,6,0.45) 0%, rgba(14,10,6,0) 22%, rgba(14,10,6,0) 42%, rgba(14,10,6,0.62) 62%, rgba(14,10,6,0.62) 78%, rgba(14,10,6,0.2) 100%)"
      : "linear-gradient(180deg, rgba(14,10,6,0.5) 0%, rgba(14,10,6,0) 20%, rgba(14,10,6,0) 42%, rgba(14,10,6,0.78) 82%, rgba(14,10,6,0.88) 100%)",
  });

  const root = h("div", { width: o.w, height: o.h, position: "relative" }, shade, top, body, count, swipe);
  const svg = await satori(root as never, { width: o.w, height: o.h, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: o.w } }).render().asPng());
}

/** Encerramento: ícone colorido do Instagram e o @ no centro. */
export async function endCardPng(w: number, hgt: number, handle: string, logo?: string | null): Promise<Buffer> {
  const root = h("div", { width: w, height: hgt, flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(14,10,6,0.55)" },
    logo ? img(logo, { height: 110, maxWidth: 420, objectFit: "contain", marginBottom: 70 }) : null,
    img(instagramIcon(true), { width: 190, height: 190 }),
    h("div", { color: "#fff", fontFamily: "Montserrat", fontWeight: 800, fontSize: 54, letterSpacing: -1, marginTop: 40 }, `@${handle.replace(/^@/, "")}`),
    h("div", { color: "#f3e3c8", fontFamily: "Cormorant", fontStyle: "italic", fontWeight: 500, fontSize: 46, marginTop: 14 }, "chama no Direct"),
  );
  const svg = await satori(root as never, { width: w, height: hgt, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: w } }).render().asPng());
}

/** Fundo da marca quando não há foto: madeira escura com luz quente de LED. */
export async function brandBackground(w: number, hgt: number, seed = 0): Promise<Buffer> {
  const y = Math.round(hgt * (0.3 + (seed % 3) * 0.08));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}">
<defs>
<linearGradient id="b" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#3b2717"/><stop offset="0.55" stop-color="#5a3b22"/><stop offset="1" stop-color="#1c130c"/></linearGradient>
<radialGradient id="l" cx="0.5" cy="0" r="0.9"><stop offset="0" stop-color="#ffcf8a" stop-opacity="0.55"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></radialGradient>
</defs>
<rect width="100%" height="100%" fill="url(#b)"/>
${Array.from({ length: 9 }, (_, i) => `<rect x="0" y="${Math.round((hgt / 9) * i)}" width="${w}" height="2" fill="#000" opacity="0.12"/>`).join("")}
<rect x="${w * 0.08}" y="${y}" width="${w * 0.84}" height="5" rx="2" fill="#ffd9a0"/>
<rect x="0" y="${y}" width="${w}" height="${hgt * 0.45}" fill="url(#l)"/>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

/** Recorta a foto para preencher o quadro, buscando a parte mais interessante. */
export async function coverImage(buf: Buffer, w: number, hgt: number): Promise<Buffer> {
  return sharp(buf).rotate().resize(w, hgt, { fit: "cover", position: sharp.strategy.attention }).jpeg({ quality: 92 }).toBuffer();
}

export async function composeStill(bg: Buffer, overlay: Buffer): Promise<Buffer> {
  return sharp(bg).composite([{ input: overlay }]).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}

/** Logo como imagem embutida, limitada em tamanho. */
export async function logoDataUri(buf: Buffer | null): Promise<string | null> {
  if (!buf) return null;
  const png = await sharp(buf).resize(600, 300, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** @ da marca para a assinatura, sem "@" nem link. */
export function brandHandle(brand: { integrations?: { instagram_handle?: string } | null; identity?: { instagram?: string } | null }) {
  const raw = brand.integrations?.instagram_handle || brand.identity?.instagram || "alphahome.moveis";
  return raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@/, "").trim() || "alphahome.moveis";
}

// ---------------------------------------------------------------- vídeo --

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const bundled = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
  return existsSync(bundled) ? bundled : "ffmpeg";
}

function run(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd });
    let err = "";
    p.stderr.on("data", (d) => { err += String(d); });
    p.on("error", (e) => reject(new Error(`Não consegui rodar o ffmpeg: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg falhou (${code}): ${err.slice(-600)}`))));
  });
}

export interface Scene {
  /** Foto já no tamanho final, ou vídeo de fundo. */
  bg: { kind: "image"; data: Buffer } | { kind: "video"; data: Buffer };
  overlay: Buffer;
  seconds: number;
}

const ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30"];

/**
 * Monta o Reels: cada cena com zoom lento (foto) ou o próprio vídeo, o texto
 * entrando com desfoque, cortes secos entre as cenas e o encerramento com o @.
 */
export async function renderReel(scenes: Scene[], end: { bg: Buffer; overlay: Buffer }, w = 1080, hgt = 1920): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reel-"));
  try {
    const parts: string[] = [];
    for (const [i, s] of scenes.entries()) {
      const d = Math.max(1, Math.min(12, s.seconds)).toFixed(2);
      const bgFile = `bg${i}.${s.bg.kind === "image" ? "jpg" : "mp4"}`;
      await writeFile(path.join(dir, bgFile), s.bg.data);
      await writeFile(path.join(dir, `ov${i}.png`), s.overlay);
      const bgIn = s.bg.kind === "image" ? ["-loop", "1", "-t", d, "-i", bgFile] : ["-stream_loop", "-1", "-t", d, "-i", bgFile];
      const bgChain = s.bg.kind === "image"
        // zoom lento de 0 a 6% durante a cena
        ? `[0:v]scale=w='${w}*(1+0.06*t/${d})':h=-2:eval=frame,crop=${w}:${hgt},setsar=1,fps=30[bg]`
        : `[0:v]scale=${w}:${hgt}:force_original_aspect_ratio=increase,crop=${w}:${hgt},setsar=1,fps=30[bg]`;
      const filter = `${bgChain};[1:v]format=rgba,split[a][b];[a]gblur=sigma=18,fade=in:st=0:d=0.45:alpha=1,fade=out:st=0.45:d=0.25:alpha=1[blur];[b]fade=in:st=0.2:d=0.5:alpha=1[sharp];[bg][blur]overlay=0:0[t];[t][sharp]overlay=0:0,format=yuv420p[v]`;
      const out = `p${i}.mp4`;
      await run([...bgIn, "-loop", "1", "-t", d, "-i", `ov${i}.png`, "-filter_complex", filter, "-map", "[v]", "-t", d, "-an", ...ENC, out], dir);
      parts.push(out);
    }
    await writeFile(path.join(dir, "endbg.jpg"), end.bg);
    await writeFile(path.join(dir, "endov.png"), end.overlay);
    await run(["-loop", "1", "-t", "2.5", "-i", "endbg.jpg", "-loop", "1", "-t", "2.5", "-i", "endov.png", "-filter_complex",
      `[0:v]scale=${w}:${hgt},gblur=sigma=30,eq=brightness=-0.12,setsar=1,fps=30[b];[1:v]format=rgba,fade=in:st=0:d=0.6:alpha=1[o];[b][o]overlay=0:0,format=yuv420p[v]`,
      "-map", "[v]", "-t", "2.5", ...ENC, "end.mp4"], dir);
    parts.push("end.mp4");
    await writeFile(path.join(dir, "list.txt"), parts.map((p) => `file '${p}'`).join("\n"));
    // Trilha muda: o áudio em alta entra no próprio Instagram.
    await run(["-f", "concat", "-safe", "0", "-i", "list.txt", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", "reel.mp4"], dir);
    return await readFile(path.join(dir, "reel.mp4"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
