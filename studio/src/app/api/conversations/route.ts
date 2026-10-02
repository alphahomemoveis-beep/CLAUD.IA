import { json, route } from "@/lib/api";
import { query } from "@/lib/db";
import { getBrand } from "@/lib/repo/brand";
import { createConversation } from "@/lib/repo/projects";

export const GET = route(async ({ req }) => {
  const brand = await getBrand();
  const archived = req.nextUrl.searchParams.get("arquivadas") === "1";
  const rows = await query(
    `SELECT c.id, c.title, c.archived, c.created_at, c.updated_at,
            p.id AS project_id, p.content_type, p.stage, p.status, p.current_version,
            (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM conversations c LEFT JOIN creative_projects p ON p.conversation_id = c.id
      WHERE c.brand_id = $1 AND c.archived = $2 AND c.kind = 'estudio'
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      ORDER BY c.updated_at DESC LIMIT 200`,
    [brand.id, archived],
  );
  return json({ conversations: rows });
});

/** ＋ Novo chat: conversa limpa, com a memória da marca intacta. */
export const POST = route(async ({ user }) => {
  const brand = await getBrand();
  const conversation = await createConversation(brand.id, user.id);
  return json({ conversation }, 201);
}, { role: "editor" });
