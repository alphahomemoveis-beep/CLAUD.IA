import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { buildJournal, writeEditorial } from "@/lib/journal/service";

export const maxDuration = 180;

export const POST = route(async ({ req, user }) => {
  const brand = await getBrand();
  const d = Number(req.nextUrl.searchParams.get("dias") ?? 30);
  const j = await buildJournal(brand, [7, 30, 90].includes(d) ? d : 30);
  return json({ editorial: await writeEditorial(brand, user.id, j) });
}, { role: "editor", rate: "ai" });
