import { z } from "zod";
import { json, route } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { conflict } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";

const Body = z.object({
  handle: z.string().trim().min(1).max(60).transform((h) => h.replace(/^@/, "").toLowerCase()),
  display_name: z.string().max(80).default(""),
  is_own: z.boolean().default(false),
});

/** Perfil para o ranking (concorrente, parceiro ou a própria marca). */
export const POST = route(async ({ req }) => {
  const brand = await getBrand();
  const b = Body.parse(await req.json());
  if (!/^[a-z0-9._]+$/.test(b.handle)) throw conflict("Use só o @ do Instagram: letras, números, ponto e sublinhado.");
  if (b.is_own) {
    const own = await queryOne(`SELECT 1 FROM tracked_profiles WHERE brand_id = $1 AND is_own`, [brand.id]);
    if (own) throw conflict("O perfil da marca já está cadastrado.");
  }
  const profile = await queryOne(
    `INSERT INTO tracked_profiles (brand_id, handle, display_name, is_own) VALUES ($1,$2,$3,$4)
     ON CONFLICT (brand_id, network, handle) DO NOTHING RETURNING *`, [brand.id, b.handle, b.display_name, b.is_own]);
  if (!profile) throw conflict("Este perfil já está no ranking.");
  return json({ profile }, 201);
}, { role: "editor" });
