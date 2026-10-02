import { route } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getImage } from "@/lib/repo/projects";
import { serveFile } from "@/lib/serve-file";

export const GET = route<{ id: string }>(async ({ params, req }) => {
  const brand = await getBrand();
  const image = await getImage(params.id, brand.id);
  if (!image) throw notFound("Imagem não encontrada.");
  const ext = image.file_key?.split(".").pop() ?? "png";
  const download = req.nextUrl.searchParams.get("baixar") === "1"
    ? `alphahome-peca-${String(image.slide_number).padStart(2, "0")}-v${String(image.version).padStart(2, "0")}.${ext}`
    : undefined;
  return serveFile(image.file_key, download);
});
