import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { buildJournal } from "@/lib/journal/service";

export const GET = route(async ({ req }) => {
  const d = Number(req.nextUrl.searchParams.get("dias") ?? 30);
  const days = [7, 30, 90].includes(d) ? d : 30;
  return json(await buildJournal(await getBrand(), days));
});
