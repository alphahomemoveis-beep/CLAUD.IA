import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../env";

/** Interface única de armazenamento. Troque o driver por variável de ambiente. */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

const KEY_RE = /^[a-z0-9-]+\/[a-zA-Z0-9-]+\.[a-z0-9]{2,5}$/;

/** Chaves sempre geradas pelo servidor: pasta/uuid.ext. Nunca usam o nome enviado. */
export function newKey(folder: "referencias" | "geradas" | "marca" | "pastas", ext: string) {
  return `${folder}/${randomUUID()}.${ext.toLowerCase()}`;
}

export function isValidKey(key: string) {
  return KEY_RE.test(key) && !key.includes("..");
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private resolve(key: string) {
    if (!isValidKey(key)) throw new Error("Chave de arquivo inválida");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Caminho fora do armazenamento");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { mode: 0o600 });
  }
  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  async remove(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/** Supabase Storage via API REST, com a chave de serviço só no servidor. */
class SupabaseStorage implements Storage {
  constructor(private url: string, private serviceKey: string, private bucket: string) {}
  private endpoint(key: string) {
    if (!isValidKey(key)) throw new Error("Chave de arquivo inválida");
    return `${this.url.replace(/\/$/, "")}/storage/v1/object/${this.bucket}/${key}`;
  }
  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }
  async put(key: string, data: Buffer, contentType: string) {
    const res = await fetch(this.endpoint(key), {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "true" }),
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Supabase Storage recusou o upload (${res.status})`);
  }
  async get(key: string) {
    const res = await fetch(this.endpoint(key).replace("/object/", "/object/authenticated/"), { headers: this.headers() });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Supabase Storage falhou ao ler (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  async remove(key: string) {
    await fetch(this.endpoint(key), { method: "DELETE", headers: this.headers() });
  }
}

let instance: Storage | null = null;

export function storage(): Storage {
  if (instance) return instance;
  const e = env();
  instance =
    e.STORAGE_DRIVER === "supabase"
      ? new SupabaseStorage(e.SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, e.SUPABASE_BUCKET)
      : new LocalStorage(path.resolve(process.cwd(), e.STORAGE_DIR));
  return instance;
}

export function mimeFromKey(key: string): string {
  const ext = key.split(".").pop() ?? "";
  return (
    { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
      mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", svg: "image/svg+xml" } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}
