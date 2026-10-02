import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";
import { pgConfig } from "./pg-config";

declare global {
  // eslint-disable-next-line no-var
  var __alphaPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__alphaPool) {
    globalThis.__alphaPool = new Pool({ ...pgConfig(env().DATABASE_URL, process.env.DATABASE_CA_CERT), max: 10 });
  }
  return globalThis.__alphaPool;
}

export type Db = Pick<PoolClient, "query">;

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query<T>(sql, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Executa várias consultas numa transação. Desfaz tudo se algo falhar. */
export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Converte um vetor numérico para o formato literal do pgvector. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
