import { route } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { serveFile } from "@/lib/serve-file";
import { getReference } from "@/lib/studio/references";

export const GET = route<{ id: string }>(async ({ params }) => {
  const brand = await getBrand();
  const ref = await getReference(params.id, brand.id);
  if (!ref) throw notFound("Referência não encontrada.");
  return serveFile(ref.file_key);
});
