import { z } from "zod";
import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { createDraft, listPosts, postView } from "@/lib/agenda/posts";
import { NETWORKS, POST_TYPES } from "@/lib/agenda/rules";
import { metricoolConfig } from "@/lib/social/metricool";
import { aiEnabled } from "@/lib/ai";

export const GET = route(async ({ req }) => {
  const brand = await getBrand();
  const sp = req.nextUrl.searchParams;
  const from = sp.get("de") ?? new Date(Date.now() - 7 * 86400_000).toISOString();
  const to = sp.get("ate") ?? new Date(Date.now() + 90 * 86400_000).toISOString();
  const ids = sp.get("ids")?.split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const posts = await listPosts(brand.id, ids?.length ? null : from, ids?.length ? null : to, ids);
  const delivery = metricoolConfig(brand.integrations?.metricool_blog_id)?.blogId ? "metricool" : "manual";
  return json({ posts, delivery, aiEnabled: aiEnabled() });
});

const Body = z.object({
  mediaIds: z.array(z.string().uuid()).min(1).max(10),
  localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
  type: z.enum(POST_TYPES),
  caption: z.string().max(2200).default(""),
  hashtags: z.array(z.string().max(80)).max(40).default([]),
  firstComment: z.string().max(1000).default(""),
  networks: z.array(z.enum(NETWORKS)).min(1).default(["instagram"]),
});

/** Post criado à mão (sem IA). Também nasce como rascunho e precisa de confirmação. */
export const POST = route(async ({ req, user }) => {
  const brand = await getBrand();
  const b = Body.parse(await req.json());
  const post = await createDraft(brand.id, user.id, null, b);
  return json({ post: await postView(brand.id, post.id) }, 201);
}, { role: "editor" });
