import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { ffmpegPath } from "./render";

export interface Shot {
  inicio: number;
  fim: number;
  duracao: number;
}

/** Cena mais curta que isso é juntada à anterior (piscadas de transição). */
const MIN_SHOT = 0.5;
/** No máximo 12 cenas: o resto é juntado às vizinhas mais curtas. */
export const MAX_SHOTS = 12;

const round = (n: number) => Math.round(n * 100) / 100;

/** Duração total, lida do cabeçalho que o ffmpeg imprime ("Duration: 00:00:15.03"). */
export function parseDuration(log: string): number | null {
  const m = log.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Instantes de corte detectados pelo filtro select+showinfo. */
export function parseCuts(log: string): number[] {
  return [...log.matchAll(/pts_time:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])).filter((t) => t > 0).sort((a, b) => a - b);
}

/** Transforma cortes em cenas, juntando as curtas demais e limitando a quantidade. */
export function shotsFromCuts(cuts: number[], total: number): Shot[] {
  const marks = [0, ...cuts.filter((t) => t < total), total];
  let shots: Shot[] = [];
  for (let i = 0; i < marks.length - 1; i++) shots.push({ inicio: marks[i], fim: marks[i + 1], duracao: marks[i + 1] - marks[i] });
  shots = shots.filter((s) => s.duracao > 0.01);
  const merge = (i: number, j: number) => {
    const a = shots[Math.min(i, j)], b = shots[Math.max(i, j)];
    shots.splice(Math.min(i, j), 2, { inicio: a.inicio, fim: b.fim, duracao: b.fim - a.inicio });
  };
  for (let i = shots.length - 1; i >= 0 && shots.length > 1; i--) {
    if (shots[i].duracao < MIN_SHOT) merge(i, i > 0 ? i - 1 : i + 1);
  }
  while (shots.length > MAX_SHOTS) {
    let k = 0;
    for (let i = 1; i < shots.length; i++) if (shots[i].duracao < shots[k].duracao) k = i;
    const neighbor = k === 0 ? 1 : k === shots.length - 1 ? k - 1 : shots[k - 1].duracao <= shots[k + 1].duracao ? k - 1 : k + 1;
    merge(k, neighbor);
  }
  return shots.map((s) => ({ inicio: round(s.inicio), fim: round(s.fim), duracao: round(s.duracao) }));
}

function ffmpeg(args: string[], cwd: string): Promise<{ code: number; log: string }> {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", ...args], { cwd });
    let log = "";
    p.stderr.on("data", (d) => { log += String(d); });
    p.on("error", (e) => resolve({ code: 1, log: String(e) }));
    p.on("close", (code) => resolve({ code: code ?? 1, log }));
  });
}

/**
 * Mede o vídeo de inspiração: onde estão os cortes, quanto dura cada cena e
 * uma foto do meio de cada cena para a IA ler o enquadramento e os textos.
 */
export async function analyzeVideo(data: Buffer): Promise<{ total: number; shots: Shot[]; frames: Buffer[] }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "insp-"));
  try {
    await writeFile(path.join(dir, "in.mp4"), data);
    const det = await ffmpeg(["-i", "in.mp4", "-an", "-vf", "scale=320:-2,select='gt(scene,0.32)',showinfo", "-f", "null", "-"], dir);
    const total = parseDuration(det.log);
    if (!total) throw new Error("Não consegui ler esse vídeo. Envie um MP4 ou MOV.");
    if (total > 180) throw new Error("O vídeo de inspiração deve ter até 3 minutos.");
    const shots = shotsFromCuts(parseCuts(det.log), total);
    const frames: Buffer[] = [];
    for (const [i, s] of shots.entries()) {
      const t = (s.inicio + s.duracao / 2).toFixed(2);
      const out = `f${i}.jpg`;
      const r = await ffmpeg(["-y", "-loglevel", "error", "-ss", t, "-i", "in.mp4", "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out], dir);
      if (r.code === 0) frames.push(await readFile(path.join(dir, out)));
    }
    return { total: round(total), shots, frames };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
