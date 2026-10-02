import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { listPosts } from "@/lib/agenda/posts";
import { metricoolConfig } from "@/lib/social/metricool";

export const GET = route(async ({ req }) => {
  const brand = await getBrand();
  const sp = req.nextUrl.searchParams;
  const from = sp.get("de") ?? new Date(Date.now() - 7 * 86400_000).toISOString();
  const to = sp.get("ate") ?? new Date(Date.now() + 90 * 86400_000).toISOString();
  const ids = sp.get("ids")?.split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const posts = await listPosts(brand.id, ids?.length ? null : from, ids?.length ? null : to, ids);
  const delivery = metricoolConfig(brand.integrations?.metricool_blog_id)?.blogId ? "metricool" : "manual";
  return json({ posts, delivery });
});
