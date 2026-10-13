import { z } from "zod";
import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { chooseOption } from "@/lib/criar/service";

const Body = z.object({ opcaoId: z.string().uuid() });

export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const b = Body.parse(await req.json());
  await chooseOption((await getBrand()).id, user.id, params.id, b.opcaoId);
  return json({ ok: true });
}, { role: "editor" });
