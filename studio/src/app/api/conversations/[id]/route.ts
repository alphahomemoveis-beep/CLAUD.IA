import { z } from "zod";
import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { effectiveAI, getBrand } from "@/lib/repo/brand";
import { getConversation, getProjectByConversation, listMessages } from "@/lib/repo/projects";
import { loadImagesForMessages, loadPlanStatus } from "@/lib/studio/views";

type P = { id: string };

export const GET = route<P>(async ({ params }) => {
  const brand = await getBrand();
  const conversation = await getConversation(params.id, brand.id);
  if (!conversation) throw notFound("Conversa não encontrada.");
  const [messages, project] = await Promise.all([listMessages(conversation.id), getProjectByConversation(conversation.id)]);
  const [images, plans] = project ? await Promise.all([loadImagesForMessages(project.id), loadPlanStatus(project.id)]) : [[], []];
  return json({ conversation, project, messages, images, plans, imageMode: effectiveAI(brand).imageProvider });
});

const Patch = z.object({ title: z.string().min(1).max(120).optional(), archived: z.boolean().optional() });

export const PATCH = route<P>(async ({ params, req }) => {
  const brand = await getBrand();
  const body = Patch.parse(await req.json());
  const conversation = await getConversation(params.id, brand.id);
  if (!conversation) throw notFound("Conversa não encontrada.");
  const rows = await query(
    `UPDATE conversations SET title = COALESCE($1, title), archived = COALESCE($2, archived), updated_at = now() WHERE id = $3 RETURNING *`,
    [body.title ?? null, body.archived ?? null, conversation.id],
  );
  return json({ conversation: rows[0] });
}, { role: "editor" });
