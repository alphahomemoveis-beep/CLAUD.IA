import { z } from "zod";
import { json, route } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { getBrand } from "@/lib/repo/brand";
import { getConversation, getProjectByConversation } from "@/lib/repo/projects";
import { handleAction } from "@/lib/studio/engine";
import { loadImagesForMessages, loadPlanStatus } from "@/lib/studio/views";

export const maxDuration = 300;

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(4000) }),
  z.object({ type: z.literal("choose_concept"), conceptId: z.string().uuid() }),
  z.object({ type: z.literal("approve_plan"), planId: z.string().uuid() }),
  z.object({ type: z.literal("revise_plan"), notes: z.string().trim().min(1).max(4000) }),
  z.object({ type: z.literal("regenerate_concepts"), notes: z.string().trim().max(4000) }),
]);

export const POST = route<{ id: string }>(async ({ params, req, user }) => {
  const brand = await getBrand();
  const conversation = await getConversation(params.id, brand.id);
  if (!conversation) throw notFound("Conversa não encontrada.");
  const action = Action.parse(await req.json());
  const messages = await handleAction(user.id, conversation.id, action);
  const project = await getProjectByConversation(conversation.id);
  const [images, plans] = project ? await Promise.all([loadImagesForMessages(project.id), loadPlanStatus(project.id)]) : [[], []];
  return json({ messages, project, images, plans });
}, { role: "editor", rate: "ai" });
