import { z } from "zod";
import { json, route } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getConversation } from "@/lib/repo/projects";
import { handleAgendaMessage } from "@/lib/agenda/agent";

export const maxDuration = 300;

const Body = z.object({
  text: z.string().trim().min(1).max(4000),
  mediaIds: z.array(z.string().uuid()).max(10).default([]),
});

export const POST = route<{ id: string }>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const conversation = await getConversation(params.id, brand.id, "agenda");
  if (!conversation) throw notFound("Conversa não encontrada.");
  const b = Body.parse(await req.json());
  const messages = await handleAgendaMessage(user.id, conversation.id, b.text, b.mediaIds);
  return json({ messages });
}, { role: "editor", rate: "ai" });
