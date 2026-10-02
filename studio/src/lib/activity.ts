import "server-only";
import { query } from "./db";
import { log } from "./logger";

/** Registra uma ação no log de auditoria. Falhas aqui nunca derrubam a requisição. */
export async function logActivity(
  userId: string | null,
  action: string,
  entity?: string,
  entityId?: string,
  details?: Record<string, unknown>,
  ip?: string | null,
) {
  try {
    await query(
      `INSERT INTO activity_logs (user_id, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, action, entity ?? null, entityId ?? null, details ? JSON.stringify(details) : null, ip ?? null],
    );
  } catch (err) {
    log.warn("falha_log_atividade", { action, err });
  }
}
