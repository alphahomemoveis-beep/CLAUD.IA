import { z } from "zod";
import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { postView, updatePost } from "@/lib/agenda/posts";
import { NETWORKS, POST_TYPES } from "@/lib/agenda/rules";

const Patch = z.object({
  localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/).optional(),
  caption: z.string().max(2200).optional(),
  hashtags: z.array(z.string().max(80)).max(40).optional(),
  firstComment: z.string().max(1000).optional(),
  type: z.enum(POST_TYPES).optional(),
  networks: z.array(z.enum(NETWORKS)).min(1).optional(),
  mediaIds: z.array(z.string().uuid()).max(10).optional(),
});

/** Edição manual. Um post agendado volta a rascunho até nova confirmação. */
export const PATCH = route<{ id: string }>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const b = Patch.parse(await req.json());
  const post = await updatePost(brand.id, user.id, params.id, b);
  return json({ post: await postView(brand.id, post.id) });
}, { role: "editor" });
