import { json, route } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getConversation, listMessages } from "@/lib/repo/projects";

export const GET = route<{ id: string }>(async ({ params }) => {
  const brand = await getBrand();
  const conversation = await getConversation(params.id, brand.id, "agenda");
  if (!conversation) throw notFound("Conversa não encontrada.");
  return json({ conversation, messages: await listMessages(conversation.id) });
});
