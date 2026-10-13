import { route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { notFound } from "@/lib/errors";
import { serveFile } from "@/lib/serve-file";
import { getCreation } from "@/lib/criar/service";

/** O vídeo de inspiração enviado, para assistir de novo ao lado da receita. */
export const GET = route<{ id: string }>(async ({ params }) => {
  const c = await getCreation(params.id, (await getBrand()).id);
  if (!c?.inspiration?.file_key) throw notFound("Essa criação não tem vídeo de inspiração enviado.");
  return serveFile(c.inspiration.file_key);
});
