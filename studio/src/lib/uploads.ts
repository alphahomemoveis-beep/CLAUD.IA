/**
 * Valida uploads pelo conteúdo real do arquivo (assinatura binária), sem
 * confiar na extensão nem no tipo informado pelo navegador.
 */
export type MediaKind = "image" | "video";

export interface DetectedFile {
  mime: string;
  ext: string;
  kind: MediaKind;
}

function startsWith(buf: Uint8Array, sig: number[], offset = 0) {
  return sig.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...buf.slice(start, end));
}

export function detectFile(buf: Uint8Array): DetectedFile | null {
  if (buf.length < 12) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", kind: "image" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png", kind: "image" };
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", kind: "image" };
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return { mime: "image/gif", ext: "gif", kind: "image" };
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (brand === "qt  ") return { mime: "video/quicktime", ext: "mov", kind: "video" };
    if (/^(heic|heix|mif1|avif)/.test(brand)) return null; // HEIC/AVIF: peça para converter
    return { mime: "video/mp4", ext: "mp4", kind: "video" };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", ext: "webm", kind: "video" };
  return null;
}

export const ACCEPTED_DESCRIPTION = "JPG, PNG, WEBP, GIF, MP4, MOV ou WEBM";

/** Imagens que os modelos de visão aceitam diretamente. */
export const VISION_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
