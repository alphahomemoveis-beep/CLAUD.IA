import "server-only";
import { query } from "../db";

/** Dados das peças, sem o caminho interno do arquivo. */
export async function loadImagesForMessages(projectId: string) {
  return query(
    `SELECT id, slide_number, slide_role, version, prompt, quality_review, status, error, model, size,
            (file_key IS NOT NULL) AS has_file, verdict, favorite, revision_of, created_at, generated_at
       FROM generated_images WHERE project_id = $1 ORDER BY version, slide_number`,
    [projectId],
  );
}

export async function loadPlanStatus(projectId: string) {
  return query(`SELECT id, version, approved FROM creative_plans WHERE project_id = $1 ORDER BY version`, [projectId]);
}
