import "server-only";
import { query, queryOne } from "../db";

export interface PromptVersion {
  id: string;
  master_prompt_id: string;
  version: number;
  content: string;
  notes: string;
  is_active: boolean;
  created_at: string;
  created_by_name: string | null;
}

export interface MasterPrompt {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  versions: PromptVersion[];
}

export async function listMasterPrompts(brandId: string): Promise<MasterPrompt[]> {
  const prompts = await query<Omit<MasterPrompt, "versions">>(
    `SELECT id, title, description, enabled, sort_order, created_at, updated_at FROM master_prompts
      WHERE brand_id = $1 ORDER BY sort_order, created_at`,
    [brandId],
  );
  const versions = await query<PromptVersion>(
    `SELECT v.*, u.name AS created_by_name FROM prompt_versions v
       JOIN master_prompts m ON m.id = v.master_prompt_id LEFT JOIN users u ON u.id = v.created_by
      WHERE m.brand_id = $1 ORDER BY v.version DESC`,
    [brandId],
  );
  return prompts.map((p) => ({ ...p, versions: versions.filter((v) => v.master_prompt_id === p.id) }));
}

export const getMasterPrompt = (id: string, brandId: string) =>
  queryOne<Omit<MasterPrompt, "versions">>(`SELECT * FROM master_prompts WHERE id = $1 AND brand_id = $2`, [id, brandId]);

export const getVersion = (id: string, brandId: string) =>
  queryOne<PromptVersion>(
    `SELECT v.*, NULL AS created_by_name FROM prompt_versions v JOIN master_prompts m ON m.id = v.master_prompt_id
      WHERE v.id = $1 AND m.brand_id = $2`,
    [id, brandId],
  );
