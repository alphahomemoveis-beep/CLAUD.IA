import "server-only";
import { query, queryOne } from "../db";

export const STAGES = ["projeto", "obra", "resultado"] as const;
export type FolderStage = (typeof STAGES)[number];

export interface Folder {
  id: string;
  brand_id: string;
  parent_id: string | null;
  name: string;
  description: string;
  address: string;
  client_name: string;
  created_at: string;
  updated_at: string;
}

export interface FolderSummary extends Folder {
  subfolders: number;
  projeto: number;
  obra: number;
  resultado: number;
  cover_media_id: string | null;
  cover_media_type: string | null;
}

export interface FolderMedia {
  id: string;
  folder_id: string;
  stage: FolderStage;
  media_type: "image" | "video";
  mime_type: string;
  file_key: string;
  file_size: number;
  original_name: string;
  caption: string;
  reference_id: string | null;
  created_at: string;
}

export const getFolder = (id: string, brandId: string) =>
  queryOne<Folder>(`SELECT * FROM folders WHERE id = $1 AND brand_id = $2`, [id, brandId]);

/** Caminho da raiz até a pasta: [Condomínio La Paloma, Casa 12]. */
export async function breadcrumb(id: string) {
  return query<{ id: string; name: string; depth: number }>(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id, name, 0 AS depth FROM folders WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id, f.name, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent_id
     ) SELECT id, name, depth FROM up ORDER BY depth DESC`,
    [id],
  );
}

/** Subpastas com contagem de mídias por etapa (incluindo as subpastas delas) e uma capa. */
export async function childFolders(brandId: string, parentId: string | null): Promise<FolderSummary[]> {
  return query<FolderSummary>(
    `WITH RECURSIVE tree AS (
       SELECT f.id AS root, f.id FROM folders f WHERE f.brand_id = $1 AND f.parent_id IS NOT DISTINCT FROM $2
       UNION ALL
       SELECT t.root, c.id FROM folders c JOIN tree t ON c.parent_id = t.id
     )
     SELECT f.*,
       (SELECT COUNT(*)::int FROM folders s WHERE s.parent_id = f.id) AS subfolders,
       (SELECT COUNT(*)::int FROM folder_media m JOIN tree t ON m.folder_id = t.id WHERE t.root = f.id AND m.stage = 'projeto') AS projeto,
       (SELECT COUNT(*)::int FROM folder_media m JOIN tree t ON m.folder_id = t.id WHERE t.root = f.id AND m.stage = 'obra') AS obra,
       (SELECT COUNT(*)::int FROM folder_media m JOIN tree t ON m.folder_id = t.id WHERE t.root = f.id AND m.stage = 'resultado') AS resultado,
       (SELECT m.id FROM folder_media m JOIN tree t ON m.folder_id = t.id WHERE t.root = f.id
         ORDER BY (m.stage = 'resultado') DESC, (m.media_type = 'image') DESC, m.created_at DESC LIMIT 1) AS cover_media_id,
       (SELECT m.media_type FROM folder_media m JOIN tree t ON m.folder_id = t.id WHERE t.root = f.id
         ORDER BY (m.stage = 'resultado') DESC, (m.media_type = 'image') DESC, m.created_at DESC LIMIT 1) AS cover_media_type
     FROM folders f WHERE f.brand_id = $1 AND f.parent_id IS NOT DISTINCT FROM $2
     ORDER BY lower(f.name)`,
    [brandId, parentId],
  );
}

export const listMedia = (folderId: string) =>
  query<FolderMedia>(`SELECT * FROM folder_media WHERE folder_id = $1 ORDER BY stage, created_at DESC`, [folderId]);

export const getMedia = (id: string, brandId: string) =>
  queryOne<FolderMedia>(`SELECT * FROM folder_media WHERE id = $1 AND brand_id = $2`, [id, brandId]);

/** true se "candidate" está dentro de "folderId" (para não mover uma pasta para dentro dela mesma). */
export async function isDescendant(folderId: string, candidate: string) {
  const row = await queryOne<{ ok: boolean }>(
    `WITH RECURSIVE down AS (
       SELECT id FROM folders WHERE id = $1
       UNION ALL SELECT f.id FROM folders f JOIN down d ON f.parent_id = d.id
     ) SELECT EXISTS (SELECT 1 FROM down WHERE id = $2) AS ok`,
    [folderId, candidate],
  );
  return !!row?.ok;
}

/** Todas as mídias de uma pasta e das subpastas (para apagar os arquivos). */
export const mediaKeysUnder = (folderId: string) =>
  query<{ file_key: string }>(
    `WITH RECURSIVE down AS (
       SELECT id FROM folders WHERE id = $1
       UNION ALL SELECT f.id FROM folders f JOIN down d ON f.parent_id = d.id
     ) SELECT m.file_key FROM folder_media m JOIN down d ON m.folder_id = d.id`,
    [folderId],
  );

export interface MediaSearchHit {
  id: string;
  pasta: string;
  etapa: FolderStage;
  tipo: "image" | "video";
  legenda: string;
  arquivo: string;
  enviada_em: string;
}

/**
 * Busca mídias pelo caminho da pasta, legenda e nome do arquivo. Usada pela
 * agenda: "o vídeo da obra da Casa 12 do La Paloma".
 */
export async function searchMedia(
  brandId: string, terms: string, opts: { stage?: FolderStage | null; type?: "image" | "video" | null; limit?: number } = {},
): Promise<MediaSearchHit[]> {
  const words = terms.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{2,}/g) ?? [];
  const stop = new Set(["de", "da", "do", "das", "dos", "para", "pra", "com", "em", "no", "na", "um", "uma", "o", "a", "os", "as", "e",
    "video", "videos", "foto", "fotos", "imagem", "imagens", "post", "agenda", "agende", "agendar", "coloca", "coloque", "posta", "postar"]);
  const useful = [...new Set(words.filter((w) => !stop.has(w)))].slice(0, 10);
  const rows = await query<MediaSearchHit & { score: number }>(
    `WITH RECURSIVE paths AS (
       SELECT id, name::text AS path FROM folders WHERE brand_id = $1 AND parent_id IS NULL
       UNION ALL SELECT f.id, p.path || ' / ' || f.name FROM folders f JOIN paths p ON f.parent_id = p.id
     )
     SELECT m.id, p.path AS pasta, m.stage AS etapa, m.media_type AS tipo, m.caption AS legenda,
            m.original_name AS arquivo, m.created_at AS enviada_em,
            (SELECT COUNT(*) FROM unnest($2::text[]) w
              WHERE translate(lower(p.path || ' ' || m.caption || ' ' || m.original_name || ' ' || m.stage),
                              'áàâãéêíóôõúç', 'aaaaeeiooouc') LIKE '%' || w || '%')::int AS score
       FROM folder_media m JOIN paths p ON p.id = m.folder_id
      WHERE m.brand_id = $1
        AND ($3::text IS NULL OR m.stage = $3)
        AND ($4::text IS NULL OR m.media_type = $4)
      ORDER BY score DESC, m.created_at DESC
      LIMIT $5`,
    [brandId, useful, opts.stage ?? null, opts.type ?? null, opts.limit ?? 8],
  );
  const best = rows[0]?.score ?? 0;
  return rows.filter((r) => (useful.length ? r.score > 0 && r.score >= best - 1 : true)).map(({ score: _s, ...r }) => r);
}

/** Caminho legível de cada pasta, para o agente e para os seletores. */
export const folderPaths = (brandId: string) =>
  query<{ id: string; path: string; media: number }>(
    `WITH RECURSIVE paths AS (
       SELECT id, name::text AS path FROM folders WHERE brand_id = $1 AND parent_id IS NULL
       UNION ALL SELECT f.id, p.path || ' / ' || f.name FROM folders f JOIN paths p ON f.parent_id = p.id
     ) SELECT p.id, p.path, (SELECT COUNT(*)::int FROM folder_media m WHERE m.folder_id = p.id) AS media
       FROM paths p ORDER BY lower(p.path)`,
    [brandId],
  );
