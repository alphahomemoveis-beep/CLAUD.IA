type Level = "debug" | "info" | "warn" | "error";

const SECRET_KEYS = /key|token|password|secret|authorization|cookie/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[oculto]" : scrub(v, depth + 1);
  return out;
}

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data ? (scrub(data) as object) : {}) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/** Log estruturado em JSON. Campos com nome de credencial são ocultados. */
export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== "production") write("debug", msg, data);
  },
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
