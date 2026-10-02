import { z } from "zod";
import { json, route } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { env } from "@/lib/env";
import { badRequest } from "@/lib/errors";
import { REFERENCE_CATEGORIES } from "@/lib/ai/schemas";
import { getBrand } from "@/lib/repo/brand";
import { newKey, storage } from "@/lib/storage";
import { ACCEPTED_DESCRIPTION, detectFile } from "@/lib/uploads";
import { analyzeReference, REFERENCE_SELECT, setTags } from "@/lib/studio/references";
import { logActivity } from "@/lib/activity";

export const maxDuration = 120;

const FILTERS = ["favoritas", "aprovadas", "rejeitadas", "em_avaliacao", "referencia"] as const;

export const GET = route(async ({ req }) => {
  const brand = await getBrand();
  const sp = req.nextUrl.searchParams;
  const category = sp.get("categoria");
  const filter = sp.get("filtro");
  const q = sp.get("q")?.trim();
  const where = ["r.brand_id = $1"];
  const params: unknown[] = [brand.id];
  if (category && (REFERENCE_CATEGORIES as readonly string[]).includes(category)) {
    params.push(category);
    where.push(`r.category = $${params.length}`);
  }
  if (filter && (FILTERS as readonly string[]).includes(filter)) {
    if (filter === "favoritas") where.push("r.favorite");
    else {
      params.push({ aprovadas: "aprovada", rejeitadas: "rejeitada", em_avaliacao: "em_avaliacao", referencia: "referencia" }[filter]);
      where.push(`r.status = $${params.length}`);
    }
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`(r.name ILIKE $${params.length} OR r.visual_description ILIKE $${params.length} OR EXISTS (SELECT 1 FROM reference_tags t WHERE t.reference_id = r.id AND t.tag ILIKE $${params.length}))`);
  }
  const references = await query(`SELECT ${REFERENCE_SELECT} FROM visual_references r WHERE ${where.join(" AND ")} ORDER BY r.favorite DESC, r.created_at DESC LIMIT 300`, params);
  const counts = await query(
    `SELECT category, status, favorite, COUNT(*)::int AS n FROM visual_references WHERE brand_id = $1 GROUP BY category, status, favorite`,
    [brand.id],
  );
  return json({ references, counts });
});

const Meta = z.object({
  name: z.string().max(120).optional(),
  category: z.enum(REFERENCE_CATEGORIES).optional(),
  tags: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  analyze: z.enum(["1", "0"]).optional(),
});

/** Upload de referência: valida o conteúdo real, guarda e manda analisar. */
export const POST = route(async ({ req, user, ip }) => {
  const brand = await getBrand();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Envie um arquivo no campo 'file'.");
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > maxBytes) throw badRequest(`Arquivo maior que ${env().MAX_UPLOAD_MB} MB.`);
  if (file.size === 0) throw badRequest("Arquivo vazio.");
  const buf = Buffer.from(await file.arrayBuffer());
  const detected = detectFile(buf);
  if (!detected) throw badRequest(`Formato não aceito. Envie ${ACCEPTED_DESCRIPTION}.`);

  const meta = Meta.parse(Object.fromEntries([...form.entries()].filter(([k]) => k !== "file").map(([k, v]) => [k, String(v)])));
  const key = newKey("referencias", detected.ext);
  await storage().put(key, buf, detected.mime);
  const originalName = file.name.replace(/\.[^.]+$/, "").slice(0, 120);
  const ref = await queryOne<{ id: string }>(
    `INSERT INTO visual_references (brand_id, name, category, media_type, mime_type, file_key, file_size, user_notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [brand.id, meta.name?.trim() || originalName || "Sem nome", meta.category ?? "ambientes", detected.kind, detected.mime, key, buf.length, meta.notes ?? "", user.id],
  );
  if (meta.tags) await setTags(ref!.id, meta.tags.split(","));
  await logActivity(user.id, "referencia_enviada", "visual_references", ref!.id, { tipo: detected.mime, bytes: buf.length }, ip);
  const reference = meta.analyze === "0"
    ? await queryOne(`SELECT ${REFERENCE_SELECT} FROM visual_references r WHERE r.id = $1`, [ref!.id])
    : await analyzeReference(ref!.id);
  return json({ reference }, 201);
}, { role: "editor", rate: "upload" });
