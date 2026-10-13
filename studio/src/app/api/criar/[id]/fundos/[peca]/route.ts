import { route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { notFound } from "@/lib/errors";
import { serveFile } from "@/lib/serve-file";
import { getCreation } from "@/lib/criar/service";

export const GET = route<{ id: string; peca: string }>(async ({ params }) => {
  const c = await getCreation(params.id, (await getBrand()).id);
  const bg = c?.backgrounds.find((b) => b.peca === Number(params.peca));
  if (!bg) throw notFound("Essa peça ainda não tem fundo.");
  return serveFile(bg.file_key);
});
