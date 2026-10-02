import { json, route } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { analyzeReference, getReference } from "@/lib/studio/references";

export const maxDuration = 120;

export const POST = route<{ id: string }>(async ({ params }) => {
  const brand = await getBrand();
  if (!(await getReference(params.id, brand.id))) throw notFound("Referência não encontrada.");
  return json({ reference: await analyzeReference(params.id) });
}, { role: "editor", rate: "ai" });
