import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { confirmPost, postView } from "@/lib/agenda/posts";

export const maxDuration = 120;

export const POST = route<{ id: string }>(async ({ params, user }) => {
  const brand = await getBrand();
  const post = await confirmPost(brand.id, user.id, params.id);
  return json({ post: await postView(brand.id, post.id) });
}, { role: "editor" });
