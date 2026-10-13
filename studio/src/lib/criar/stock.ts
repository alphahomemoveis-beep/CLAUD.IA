import "server-only";
import { env } from "../env";
import { AppError } from "../errors";

/**
 * Bancos gratuitos de fotos e vídeos para os fundos: Pixabay (pixabay.com/api/docs)
 * ou Pexels (pexels.com/api). Usa o que tiver chave; com as duas, o Pixabay.
 * A tela mostra de onde vem cada imagem e o crédito do autor. Os arquivos são
 * baixados para o armazenamento do app, sem link direto para o banco.
 * O Pinterest não tem busca aberta para aplicativos, por isso não entra.
 */
export type StockSource = "pixabay" | "pexels";
export const STOCK_LABEL: Record<StockSource, string> = { pixabay: "Pixabay", pexels: "Pexels" };

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

export function stockSource(): StockSource | null {
  const e = env();
  return e.PIXABAY_API_KEY ? "pixabay" : e.PEXELS_API_KEY ? "pexels" : null;
}

const OFF = "A busca de fotos está desligada. Cadastre PIXABAY_API_KEY (grátis em pixabay.com/api/docs) na Railway. Ou envie suas fotos, ou use as das Pastas.";

async function getJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new AppError(429, `O limite de buscas do ${label} acabou por agora. Tente de novo daqui a pouco.`, "banco_limite");
  if (res.status === 400 && label === "Pixabay" && /key/i.test(await res.clone().text())) throw new AppError(503, "A chave do Pixabay (PIXABAY_API_KEY) é inválida.", "banco_chave");
  if (res.status === 401 || res.status === 403) throw new AppError(503, `O ${label} recusou a chave. Confira a variável na Railway.`, "banco_chave");
  if (!res.ok) throw new AppError(502, `O ${label} respondeu com erro ${res.status}.`, "banco_erro");
  return (await res.json()) as T;
}

// ------------------------------------------------------------------ Pixabay --

interface PixabayImage {
  id: number; pageURL: string; previewURL: string; webformatURL: string; largeImageURL: string;
  fullHDURL?: string; imageWidth: number; imageHeight: number; user: string; user_id: number;
}
interface PixabayVideo {
  id: number; pageURL: string; duration: number; user: string; user_id: number;
  videos: Record<"large" | "medium" | "small" | "tiny", { url: string; width: number; height: number; size: number; thumbnail?: string }>;
}

const pixabayUser = (user: string, id: number) => `https://pixabay.com/users/${encodeURIComponent(user)}-${id}/`;
const pixabayImage = (p: PixabayImage): StockItem => ({
  id: p.id, tipo: "foto", thumb: p.webformatURL || p.previewURL, largura: p.imageWidth, altura: p.imageHeight,
  autor: p.user, autor_url: pixabayUser(p.user, p.user_id), pagina: p.pageURL,
});
const pixabayVideo = (v: PixabayVideo): StockItem => ({
  id: v.id, tipo: "video", thumb: v.videos.medium?.thumbnail || v.videos.small?.thumbnail || v.videos.tiny?.thumbnail || "",
  largura: v.videos.large?.width || v.videos.medium?.width || 0, altura: v.videos.large?.height || v.videos.medium?.height || 0,
  autor: v.user, autor_url: pixabayUser(v.user, v.user_id), pagina: v.pageURL, duracao: v.duration,
});

function pixabayUrl(tipo: "foto" | "video", params: Record<string, string>) {
  const q = new URLSearchParams({ key: env().PIXABAY_API_KEY!, safesearch: "true", ...params });
  return `https://pixabay.com/api/${tipo === "video" ? "videos/" : ""}?${q}`;
}

/** Vídeo do Pixabay: o maior que não passe de 4K, que é o que fica nítido em 1080x1920. */
export function pickPixabayVideo(v: PixabayVideo["videos"]) {
  return (["large", "medium", "small", "tiny"] as const).map((k) => v[k]).find((f) => f?.url && Math.max(f.width, f.height) <= 3840) ?? null;
}

// ------------------------------------------------------------------- Pexels --

interface PexelsPhoto {
  id: number; width: number; height: number; url: string; photographer: string; photographer_url: string;
  src: { original: string; large2x: string; large: string; medium: string; portrait: string };
}
interface PexelsVideo {
  id: number; width: number; height: number; url: string; image: string; duration: number;
  user: { name: string; url: string };
  video_files: Array<{ quality: string | null; file_type: string; width: number | null; height: number | null; link: string }>;
}
const pexelsPhoto = (p: PexelsPhoto): StockItem => ({
  id: p.id, tipo: "foto", thumb: p.src.portrait || p.src.medium, largura: p.width, altura: p.height,
  autor: p.photographer, autor_url: p.photographer_url, pagina: p.url,
});
const pexelsVideo = (v: PexelsVideo): StockItem => ({
  id: v.id, tipo: "video", thumb: v.image, largura: v.width, altura: v.height, autor: v.user.name, autor_url: v.user.url,
  pagina: v.url, duracao: v.duration,
});
const pexels = <T>(pathname: string) => getJson<T>(`https://api.pexels.com${pathname}`, { headers: { Authorization: env().PEXELS_API_KEY! } }, "Pexels");

/** Melhor arquivo de vídeo do Pexels: mp4 com altura perto de 1920, sem passar de 4K. */
export function pickVideoFile(files: PexelsVideo["video_files"]) {
  const mp4 = files.filter((f) => f.file_type === "video/mp4" && f.width && f.height && f.link);
  const score = (f: (typeof mp4)[number]) => {
    const tall = Math.max(f.width!, f.height!);
    return tall > 2200 ? 10_000 + tall : Math.abs(1920 - tall);
  };
  return mp4.sort((a, b) => score(a) - score(b))[0] ?? null;
}

// -------------------------------------------------------------------- comum --

export async function searchStock(q: string, tipo: "foto" | "video"): Promise<StockItem[]> {
  const source = stockSource();
  if (!source) throw new AppError(503, OFF, "banco_desligado");
  const query = q.slice(0, 80);
  if (source === "pixabay") {
    const params = { q: query, per_page: "24", ...(tipo === "foto" ? { image_type: "photo", orientation: "vertical", lang: "pt" } : { video_type: "film", lang: "pt" }) };
    if (tipo === "video") return (await getJson<{ hits: PixabayVideo[] }>(pixabayUrl("video", params), {}, "Pixabay")).hits.map(pixabayVideo);
    return (await getJson<{ hits: PixabayImage[] }>(pixabayUrl("foto", params), {}, "Pixabay")).hits.map(pixabayImage);
  }
  const params = new URLSearchParams({ query, per_page: "18", locale: "pt-BR", orientation: "portrait" });
  if (tipo === "video") return (await pexels<{ videos: PexelsVideo[] }>(`/videos/search?${params}`)).videos.map(pexelsVideo);
  return (await pexels<{ photos: PexelsPhoto[] }>(`/v1/search?${params}`)).photos.map(pexelsPhoto);
}

const ALLOWED_HOSTS = /(^|\.)(pixabay\.com|pexels\.com|vimeo\.com|vimeocdn\.com)$/;

/**
 * Baixa pelo id, nunca por um link vindo do navegador: o servidor consulta o
 * banco e só baixa dos endereços que a API devolver.
 */
export async function downloadStock(id: number, tipo: "foto" | "video"): Promise<{ data: Buffer; item: StockItem; source: StockSource }> {
  const source = stockSource();
  if (!source) throw new AppError(503, OFF, "banco_desligado");
  let link: string | null = null;
  let item: StockItem | null = null;
  if (source === "pixabay") {
    if (tipo === "video") {
      const v = (await getJson<{ hits: PixabayVideo[] }>(pixabayUrl("video", { id: String(id) }), {}, "Pixabay")).hits[0];
      if (v) { item = pixabayVideo(v); link = pickPixabayVideo(v.videos)?.url ?? null; }
    } else {
      const p = (await getJson<{ hits: PixabayImage[] }>(pixabayUrl("foto", { id: String(id) }), {}, "Pixabay")).hits[0];
      if (p) { item = pixabayImage(p); link = p.fullHDURL || p.largeImageURL; }
    }
  } else if (tipo === "video") {
    const v = await pexels<PexelsVideo>(`/videos/videos/${id}`);
    item = pexelsVideo(v);
    link = pickVideoFile(v.video_files)?.link ?? null;
  } else {
    const p = await pexels<PexelsPhoto>(`/v1/photos/${id}`);
    const u = new URL(p.src.original);
    u.search = "auto=compress&cs=tinysrgb&h=2400";
    item = pexelsPhoto(p);
    link = u.toString();
  }
  if (!item || !link) throw new AppError(422, `Esse item do ${STOCK_LABEL[source]} não tem um arquivo utilizável. Escolha outro.`, "banco_sem_arquivo");
  if (!ALLOWED_HOSTS.test(new URL(link).hostname)) throw new AppError(502, "Endereço de download inesperado do banco de imagens.", "banco_erro");
  const res = await fetch(link, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new AppError(502, `Não consegui baixar do ${STOCK_LABEL[source]} (${res.status}).`, "banco_erro");
  if (Number(res.headers.get("content-length") ?? 0) > 150 * 1024 * 1024) throw new AppError(422, "Esse vídeo é grande demais. Escolha outro.", "banco_grande");
  return { data: Buffer.from(await res.arrayBuffer()), item, source };
}
