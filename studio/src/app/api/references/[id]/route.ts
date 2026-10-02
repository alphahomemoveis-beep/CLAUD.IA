import { z } from "zod";
import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { REFERENCE_CATEGORIES } from "@/lib/ai/schemas";
import { effectiveAI, getBrand } from "@/lib/repo/brand";
import { storage } from "@/lib/storage";
import { getReference, setTags } from "@/lib/studio/references";
import { indexReference } from "@/lib/studio/retrieval";
import { logActivity } from "@/lib/activity";
import { log } from "@/lib/logger";

type P = { id: string };

export const GET = route<P>(async ({ params }) => {
  const brand = await getBrand();
  const reference = await getReference(params.id, brand.id);
  if (!reference) throw notFound("Referência não encontrada.");
  const usage = await query(
    `SELECT p.id, p.title, pl.version FROM creative_plans pl JOIN creative_projects p ON p.id = pl.project_id
      WHERE $1 = ANY(pl.reference_ids) ORDER BY pl.created_at DESC LIMIT 20`,
    [reference.id],
  );
  return json({ reference, usage });
});

const Patch = z.object({
  name: z.string().min(1).max(120).optional(),
  category: z.enum(REFERENCE_CATEGORIES).optional(),
  status: z.enum(["referencia", "em_avaliacao", "aprovada", "rejeitada"]).optional(),
  favorite: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  user_notes: z.string().max(2000).optional(),
  visual_description: z.string().max(4000).optional(),
  environment: z.string().max(200).optional(),
  style: z.string().max(200).optional(),
  recommended_use: z.string().max(1000).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
});

export const PATCH = route<P>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const ref = await getReference(params.id, brand.id);
  if (!ref) throw notFound("Referência não encontrada.");
  const body = Patch.parse(await req.json());
  const { tags, ...fields } = body;
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    values.push(v);
    sets.push(`${k} = $${values.length}`);
  }
  if (sets.length) {
    values.push(ref.id);
    await query(`UPDATE visual_references SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
  }
  if (tags) await setTags(ref.id, tags);
  if (body.status && body.status !== ref.status) {
    await logActivity(user.id, "referencia_status", "visual_references", ref.id, { de: ref.status, para: body.status });
  }
  const textChanged = ["name", "category", "user_notes", "visual_description", "environment", "style", "recommended_use"].some((k) => k in fields) || !!tags;
  if (textChanged) await indexReference(ref.id, effectiveAI(brand)).catch((err) => log.warn("reindexacao_falhou", { err }));
  return json({ reference: await getReference(ref.id, brand.id) });
}, { role: "editor" });

export const DELETE = route<P>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const ref = await getReference(params.id, brand.id);
  if (!ref) throw notFound("Referência não encontrada.");
  if (req.nextUrl.searchParams.get("confirmar") !== "sim") throw badRequest("Confirme a exclusão da referência.");
  await query(`DELETE FROM visual_references WHERE id = $1`, [ref.id]);
  await storage().remove(ref.file_key).catch(() => undefined);
  await logActivity(user.id, "referencia_apagada", "visual_references", ref.id, { nome: ref.name });
  return json({ ok: true });
}, { role: "editor" });
