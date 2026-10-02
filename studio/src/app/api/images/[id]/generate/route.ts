import { json, route } from "@/lib/api";
import { generateImage } from "@/lib/studio/generation";

export const maxDuration = 300;

export const POST = route<{ id: string }>(async ({ params, user }) => {
  const image = await generateImage(params.id, user.id);
  const { file_key, ...rest } = image;
  return json({ image: { ...rest, has_file: !!file_key } });
}, { role: "editor", rate: "image" });
