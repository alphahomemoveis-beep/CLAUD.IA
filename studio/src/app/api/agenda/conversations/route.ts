import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { getBrand } from "@/lib/repo/brand";
import { createConversation } from "@/lib/repo/projects";

export const GET = route(async () => {
  const brand = await getBrand();
  const conversations = await query(
    `SELECT c.id, c.title, c.updated_at FROM conversations c
      WHERE c.brand_id = $1 AND c.kind = 'agenda' AND NOT c.archived
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      ORDER BY c.updated_at DESC LIMIT 30`, [brand.id]);
  return json({ conversations });
});

export const POST = route(async ({ user }) => {
  const brand = await getBrand();
  return json({ conversation: await createConversation(brand.id, user.id, "agenda") }, 201);
}, { role: "editor" });
