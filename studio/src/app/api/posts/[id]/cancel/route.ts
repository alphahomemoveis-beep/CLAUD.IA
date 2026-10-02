import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { requestCancel, postView } from "@/lib/agenda/posts";

export const maxDuration = 120;

export const POST = route<{ id: string }>(async ({ params, user }) => {
  const brand = await getBrand();
  const post = await requestCancel(brand.id, user.id, params.id);
  return json({ post: await postView(brand.id, post.id) });
}, { role: "editor" });
