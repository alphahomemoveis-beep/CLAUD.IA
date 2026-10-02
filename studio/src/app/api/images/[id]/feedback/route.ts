import { z } from "zod";
import { json, route } from "@/lib/api";
import { giveFeedback } from "@/lib/studio/feedback";

export const maxDuration = 120;

const Body = z.object({
  kind: z.enum(["aprovar", "rejeitar", "favoritar", "alterar"]),
  comment: z.string().max(2000).optional(),
  scope: z.enum(["marca", "projeto"]).optional(),
  learn: z.boolean().optional(),
});

export const POST = route<{ id: string }>(async ({ params, req, user }) => {
  const body = Body.parse(await req.json());
  const result = await giveFeedback(user.id, { imageId: params.id, ...body });
  const strip = <T extends { file_key: string | null }>(i: T) => {
    const { file_key, ...rest } = i;
    return { ...rest, has_file: !!file_key };
  };
  return json({ image: strip(result.image), revision: result.revision ? strip(result.revision) : null, lessons: result.lessons });
}, { role: "editor", rate: "ai" });
