/** Regras dos posts que valem para a IA e para as edições manuais. */

export const POST_TYPES = ["POST", "CARROSSEL", "REEL", "STORY"] as const;
export type PostType = (typeof POST_TYPES)[number];
export const NETWORKS = ["instagram", "facebook", "tiktok", "youtube", "linkedin"] as const;
export type Network = (typeof NETWORKS)[number];

export const TYPE_LABEL: Record<PostType, string> = { POST: "Post", CARROSSEL: "Carrossel", REEL: "Reels", STORY: "Story" };

/** Limite de legenda do Instagram. */
export const MAX_CAPTION = 2200;
export const MAX_HASHTAGS = 30;

export function normalizeHashtags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    for (const piece of raw.split(/[\s,]+/)) {
      const t = piece.replace(/^#+/, "").normalize("NFC").replace(/[^\p{L}\p{N}_]/gu, "");
      if (t && !out.some((o) => o.toLowerCase() === `#${t}`.toLowerCase())) out.push(`#${t}`);
    }
  }
  return out.slice(0, MAX_HASHTAGS);
}

export function fullText(caption: string, hashtags: string[]) {
  return [caption.trim(), hashtags.join(" ")].filter(Boolean).join("\n\n");
}

export interface MediaInfo { id: string; tipo: "image" | "video" }

/** Problemas que impedem o post. Lista vazia = válido. */
export function postProblems(p: {
  type: PostType; media: MediaInfo[]; caption: string; hashtags: string[]; networks: string[]; scheduledAt: Date; now?: Date;
}): string[] {
  const out: string[] = [];
  const videos = p.media.filter((m) => m.tipo === "video").length;
  const imagesN = p.media.length - videos;
  if (!p.networks.length) out.push("Escolha pelo menos uma rede.");
  if (p.type === "REEL" && (videos !== 1 || p.media.length !== 1)) out.push("Reels precisa de exatamente um vídeo.");
  if (p.type === "STORY" && p.media.length !== 1) out.push("Story precisa de exatamente uma foto ou um vídeo.");
  if (p.type === "POST" && p.media.length !== 1) out.push("Post simples usa uma mídia. Para várias fotos, use Carrossel.");
  if (p.type === "CARROSSEL" && (p.media.length < 2 || p.media.length > 10)) out.push("Carrossel usa de 2 a 10 mídias.");
  if (p.type === "CARROSSEL" && videos > 0 && imagesN === 0 && p.media.length < 2) out.push("Carrossel precisa de mais de uma mídia.");
  if (p.networks.includes("youtube") && videos === 0) out.push("YouTube só aceita vídeo.");
  if (p.networks.includes("tiktok") && p.media.length === 0) out.push("TikTok precisa de foto ou vídeo.");
  if (fullText(p.caption, p.hashtags).length > MAX_CAPTION) out.push(`Legenda com hashtags passa de ${MAX_CAPTION} caracteres.`);
  const now = p.now ?? new Date();
  if (p.scheduledAt.getTime() < now.getTime() + 5 * 60_000) out.push("O horário precisa ser pelo menos 5 minutos no futuro.");
  if (p.scheduledAt.getTime() > now.getTime() + 365 * 86400_000) out.push("Agende no máximo com um ano de antecedência.");
  return out;
}

/** Corpo do POST /v2/scheduler/posts do Metricool. */
export function metricoolPayload(p: {
  type: PostType; networks: string[]; caption: string; hashtags: string[]; firstComment: string;
  localDateTime: string; timezone: string; mediaUrls: string[];
}) {
  const igType = p.type === "REEL" ? "REEL" : p.type === "STORY" ? "STORY" : "POST";
  const body: Record<string, unknown> = {
    text: p.type === "STORY" ? "" : fullText(p.caption, p.hashtags),
    providers: p.networks.map((network) => ({ network })),
    publicationDate: { dateTime: p.localDateTime.slice(0, 19), timezone: p.timezone },
    autoPublish: true,
    draft: false,
    firstCommentText: p.firstComment,
    media: p.mediaUrls,
    mediaAltText: [],
    descendants: [],
    shortener: false,
    smartLinkData: { ids: [] },
    hasNotReadNotes: false,
  };
  if (p.networks.includes("instagram")) body.instagramData = { type: igType, showReelOnFeed: true };
  if (p.networks.includes("facebook")) body.facebookData = { type: igType === "POST" ? "POST" : igType };
  if (p.networks.includes("tiktok")) body.tiktokData = {};
  if (p.networks.includes("linkedin")) body.linkedinData = { type: "post" };
  if (p.networks.includes("youtube")) {
    body.youtubeData = { title: p.caption.split("\n")[0].slice(0, 95) || "AlphaHome", type: "short", privacy: "public", madeForKids: false };
  }
  return body;
}
