import { route } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getMedia } from "@/lib/repo/folders";
import { serveFile } from "@/lib/serve-file";

export const GET = route<{ id: string }>(async ({ params, req }) => {
  const brand = await getBrand();
  const media = await getMedia(params.id, brand.id);
  if (!media) throw notFound("Mídia não encontrada.");
  return serveFile(media.file_key, req.nextUrl.searchParams.get("baixar") === "1" ? media.original_name || "midia" : undefined);
});
