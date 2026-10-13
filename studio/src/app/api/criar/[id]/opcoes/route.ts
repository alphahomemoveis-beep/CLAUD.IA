import { z } from "zod";
import { json, route } from "@/lib/api";
import { getBrand } from "@/lib/repo/brand";
import { aiEnabled, AI_OFF_MESSAGE } from "@/lib/ai";
import { AppError } from "@/lib/errors";
import { requestNewRound } from "@/lib/criar/service";

const Body = z.object({ pedido: z.string().max(600).default("") });

/** Nenhuma das 3 agradou: a IA cria outras 3, sem repetir as anteriores. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  if (!aiEnabled()) throw new AppError(503, AI_OFF_MESSAGE, "ia_indisponivel");
  const b = Body.parse(await req.json());
  await requestNewRound(await getBrand(), user.id, params.id, b.pedido);
  return json({ ok: true }, 202);
}, { role: "editor", rate: "ai" });
