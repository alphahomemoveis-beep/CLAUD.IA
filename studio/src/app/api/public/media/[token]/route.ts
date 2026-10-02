import { type NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { mimeFromKey, storage } from "@/lib/storage";
import { verifyMediaToken } from "@/lib/social/signing";

/**
 * Entrega pública de UMA mídia por link assinado e com prazo, para o
 * Metricool buscar o arquivo do post. Sem o link certo, nada é exposto.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const secret = env().APP_SECRET;
  if (!secret) return new Response("Não disponível", { status: 404 });
  const { token } = await ctx.params;
  const mediaId = verifyMediaToken(token.replace(/\.[a-z0-9]{2,5}$/, ""), secret);
  if (!mediaId) return new Response("Link inválido ou vencido", { status: 404 });
  const media = await queryOne<{ file_key: string }>(`SELECT file_key FROM folder_media WHERE id = $1`, [mediaId]);
  const data = media ? await storage().get(media.file_key) : null;
  if (!media || !data) return new Response("Não encontrado", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mimeFromKey(media.file_key),
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
