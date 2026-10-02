import { json, route } from "@/lib/api";
import { query } from "@/lib/db";

export const GET = route(async () => {
  const activity = await query(
    `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.ip, a.created_at, u.name AS user_name
       FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 100`,
  );
  return json({ activity });
}, { role: "owner" });
