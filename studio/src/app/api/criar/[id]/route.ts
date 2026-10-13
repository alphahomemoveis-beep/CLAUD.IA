import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { creationView } from "@/lib/criar/service";
import { pexelsEnabled } from "@/lib/criar/pexels";

export const GET = route<{ id: string }>(async ({ params }) => {
  const brand = await getBrand();
  return json({ ...(await creationView(params.id, brand.id)), pexels: pexelsEnabled() });
});
