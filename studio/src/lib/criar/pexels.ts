import "server-only";
import { env } from "../env";
import { AppError } from "../errors";

/**
 * Banco gratuito de fotos e vídeos (pexels.com/api). Uso livre, inclusive
 * comercial; a tela mostra o crédito do autor e o link para o Pexels.
 * O Pinterest não tem busca aberta para aplicativos, por isso não entra aqui.
 */
const API = "https://api.pexels.com";

export interface StockItem {
  id: number;
  tipo: "foto" | "video";
  thumb: string;
  largura: number;
  altura: number;
  autor: string;
  autor_url: string;
  pagina: string;
  duracao?: number;
}

interface PexelsPhoto {
  id: number; width: number; height: number; url: string; photographer: string; photographer_url: string;
  src: { original: string; large2x: string; large: string; medium: string; portrait: string };
}
interface PexelsVideo {
  id: number; width: number; height: number; url: string; image: string; duration: number;
  user: { name: string; url: string };
  video_files: Array<{ quality: string | null; file_type: string; width: number | null; height: number | null; link: string }>;
}

export const pexelsEnabled = () => !!env().PEXELS_API_KEY;

async function call<T>(pathname: string): Promise<T> {
  const key = env().PEXELS_API_KEY;
  if (!key) throw new AppError(503, "A busca de fotos está desligada. Crie uma chave grátis em pexels.com/api e cadastre PEXELS_API_KEY na Railway.", "pexels_desligado");
  const res = await fetch(`${API}${pathname}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new AppError(429, "O limite de buscas do Pexels acabou nesta hora. Tente de novo daqui a pouco.", "pexels_limite");
  if (!res.ok) throw new AppError(502, `O Pexels respondeu com erro ${res.status}.`, "pexels_erro");
  return (await res.json()) as T;
}

const photoItem = (p: PexelsPhoto): StockItem => ({
  id: p.id, tipo: "foto", thumb: p.src.portrait || p.src.medium, largura: p.width, altura: p.height,
  autor: p.photographer, autor_url: p.photographer_url, pagina: p.url,
});
const videoItem = (v: PexelsVideo): StockItem => ({
  id: v.id, tipo: "video", thumb: v.image, largura: v.width, altura: v.height, autor: v.user.name, autor_url: v.user.url,
  pagina: v.url, duracao: v.duration,
});

export async function searchStock(q: string, tipo: "foto" | "video", vertical = true): Promise<StockItem[]> {
  const params = new URLSearchParams({ query: q.slice(0, 80), per_page: "18", locale: "pt-BR", ...(vertical ? { orientation: "portrait" } : {}) });
  if (tipo === "video") {
    const r = await call<{ videos: PexelsVideo[] }>(`/videos/search?${params}`);
    return r.videos.map(videoItem);
  }
  const r = await call<{ photos: PexelsPhoto[] }>(`/v1/search?${params}`);
  return r.photos.map(photoItem);
}

/** Melhor arquivo de vídeo: mp4 com altura perto de 1920, sem passar de 4K. */
export function pickVideoFile(files: PexelsVideo["video_files"]) {
  const mp4 = files.filter((f) => f.file_type === "video/mp4" && f.width && f.height && f.link);
  const score = (f: (typeof mp4)[number]) => {
    const tall = Math.max(f.width!, f.height!);
    return tall > 2200 ? 10_000 + tall : Math.abs(1920 - tall);
  };
  return mp4.sort((a, b) => score(a) - score(b))[0] ?? null;
}

/**
 * Baixa pelo id, nunca por um link vindo do navegador: o servidor consulta o
 * Pexels e só baixa dos endereços que a API devolver.
 */
export async function downloadStock(id: number, tipo: "foto" | "video"): Promise<{ data: Buffer; item: StockItem }> {
  let link: string;
  let item: StockItem;
  if (tipo === "video") {
    const v = await call<PexelsVideo>(`/videos/videos/${id}`);
    const file = pickVideoFile(v.video_files);
    if (!file) throw new AppError(422, "Esse vídeo do Pexels não tem um arquivo MP4 utilizável.", "pexels_sem_arquivo");
    link = file.link;
    item = videoItem(v);
  } else {
    const p = await call<PexelsPhoto>(`/v1/photos/${id}`);
    const u = new URL(p.src.original);
    u.search = "auto=compress&cs=tinysrgb&h=2400";
    link = u.toString();
    item = photoItem(p);
  }
  const host = new URL(link).hostname;
  if (!/(^|\.)pexels\.com$/.test(host) && !/(^|\.)vimeo\.com$/.test(host)) throw new AppError(502, "Endereço de download inesperado do Pexels.", "pexels_erro");
  const res = await fetch(link, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new AppError(502, `Não consegui baixar do Pexels (${res.status}).`, "pexels_erro");
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 150 * 1024 * 1024) throw new AppError(422, "Esse vídeo é grande demais. Escolha outro.", "pexels_grande");
  return { data: Buffer.from(await res.arrayBuffer()), item };
}
