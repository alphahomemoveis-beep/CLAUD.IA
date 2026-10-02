import "server-only";
import { query, queryOne } from "../db";
import { env } from "../env";
import { AppError, notFound } from "../errors";
import { logActivity } from "../activity";
import { log } from "../logger";
import { getBrand } from "../repo/brand";
import { signMediaToken } from "../social/signing";
import { createScheduledPost, deleteScheduledPost, metricoolConfig, normalizeImageUrl, updateScheduledPost } from "../social/metricool";
import { describeLocal, localToUtc, utcToLocal } from "./time";
import { metricoolPayload, normalizeHashtags, postProblems, type MediaInfo, type PostType } from "./rules";

export interface ScheduledPost {
  id: string;
  brand_id: string;
  conversation_id: string | null;
  post_type: PostType;
  networks: string[];
  caption: string;
  hashtags: string[];
  first_comment: string;
  media_ids: string[];
  scheduled_at: string;
  timezone: string;
  status: "rascunho" | "agendado" | "publicado" | "falhou" | "cancelado";
  pending_action: "cancelar" | null;
  delivery: "metricool" | "manual";
  external_id: string | null;
  external_error: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}

export class PostError extends AppError {
  constructor(message: string) {
    super(422, message, "post_invalido");
  }
}

export const timezone = () => env().APP_TIMEZONE;

export async function mediaInfo(brandId: string, ids: string[]): Promise<Array<MediaInfo & { pasta: string; etapa: string; legenda: string }>> {
  if (!ids.length) return [];
  const rows = await query<{ id: string; tipo: "image" | "video"; pasta: string; etapa: string; legenda: string }>(
    `WITH RECURSIVE paths AS (
       SELECT id, name::text AS path FROM folders WHERE brand_id = $1 AND parent_id IS NULL
       UNION ALL SELECT f.id, p.path || ' / ' || f.name FROM folders f JOIN paths p ON f.parent_id = p.id
     ) SELECT m.id, m.media_type AS tipo, p.path AS pasta, m.stage AS etapa, m.caption AS legenda
         FROM folder_media m JOIN paths p ON p.id = m.folder_id WHERE m.brand_id = $1 AND m.id = ANY($2::uuid[])`,
    [brandId, ids],
  );
  // mantém a ordem pedida
  return ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as typeof rows;
}

export interface DraftInput {
  mediaIds: string[];
  localDateTime: string;
  type: PostType;
  caption: string;
  hashtags: string[];
  firstComment?: string | null;
  networks: string[];
}

async function validate(brandId: string, d: DraftInput) {
  const tz = timezone();
  const scheduledAt = localToUtc(d.localDateTime, tz);
  const media = await mediaInfo(brandId, d.mediaIds);
  if (media.length !== d.mediaIds.length) throw new PostError("Alguma mídia não foi encontrada nas pastas.");
  const hashtags = normalizeHashtags(d.hashtags);
  const problems = postProblems({ type: d.type, media, caption: d.caption, hashtags, networks: d.networks, scheduledAt });
  if (problems.length) throw new PostError(problems.join(" "));
  return { scheduledAt, hashtags, media, tz };
}

/** Rascunho criado pela IA ou pela tela. Nada vai para a rede antes da confirmação. */
export async function createDraft(brandId: string, userId: string, conversationId: string | null, d: DraftInput): Promise<ScheduledPost> {
  const { scheduledAt, hashtags, tz } = await validate(brandId, d);
  const post = (await queryOne<ScheduledPost>(
    `INSERT INTO scheduled_posts (brand_id, conversation_id, post_type, networks, caption, hashtags, first_comment, media_ids,
                                  scheduled_at, timezone, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [brandId, conversationId, d.type, d.networks, d.caption.trim(), hashtags, (d.firstComment ?? "").trim(), d.mediaIds, scheduledAt, tz, userId],
  ))!;
  await logActivity(userId, "post_rascunho", "scheduled_posts", post.id, { quando: scheduledAt.toISOString() });
  return post;
}

export const getPost = (id: string, brandId: string) =>
  queryOne<ScheduledPost>(`SELECT * FROM scheduled_posts WHERE id = $1 AND brand_id = $2`, [id, brandId]);

/**
 * Alterar um post já agendado o devolve a rascunho: a mudança precisa de
 * nova confirmação antes de valer.
 */
export async function updatePost(brandId: string, userId: string, id: string, patch: Partial<DraftInput>): Promise<ScheduledPost> {
  const post = await getPost(id, brandId);
  if (!post) throw notFound("Post não encontrado.");
  if (post.status === "publicado" || post.status === "cancelado") throw new PostError(`Este post já está ${post.status}.`);
  const merged: DraftInput = {
    mediaIds: patch.mediaIds ?? post.media_ids,
    localDateTime: patch.localDateTime ?? utcToLocal(new Date(post.scheduled_at), post.timezone),
    type: patch.type ?? post.post_type,
    caption: patch.caption ?? post.caption,
    hashtags: patch.hashtags ?? post.hashtags,
    firstComment: patch.firstComment ?? post.first_comment,
    networks: patch.networks ?? post.networks,
  };
  const { scheduledAt, hashtags } = await validate(brandId, merged);
  const updated = (await queryOne<ScheduledPost>(
    `UPDATE scheduled_posts SET post_type = $1, networks = $2, caption = $3, hashtags = $4, first_comment = $5, media_ids = $6,
            scheduled_at = $7, status = 'rascunho', pending_action = NULL, external_error = NULL, updated_at = now()
      WHERE id = $8 RETURNING *`,
    [merged.type, merged.networks, merged.caption.trim(), hashtags, (merged.firstComment ?? "").trim(), merged.mediaIds, scheduledAt, id],
  ))!;
  await logActivity(userId, "post_alterado", "scheduled_posts", id);
  return updated;
}

/** Pedido de cancelamento: rascunho cancela na hora; agendado pede confirmação. */
export async function requestCancel(brandId: string, userId: string, id: string): Promise<ScheduledPost> {
  const post = await getPost(id, brandId);
  if (!post) throw notFound("Post não encontrado.");
  if (post.status === "rascunho") {
    await logActivity(userId, "post_rascunho_descartado", "scheduled_posts", id);
    return (await queryOne<ScheduledPost>(`UPDATE scheduled_posts SET status = 'cancelado', updated_at = now() WHERE id = $1 RETURNING *`, [id]))!;
  }
  if (post.status !== "agendado") throw new PostError(`Este post está ${post.status} e não pode ser cancelado.`);
  return (await queryOne<ScheduledPost>(`UPDATE scheduled_posts SET pending_action = 'cancelar', updated_at = now() WHERE id = $1 RETURNING *`, [id]))!;
}

/** Link público assinado de cada mídia, para o Metricool buscar o arquivo. */
function publicMediaUrls(post: ScheduledPost, media: Array<{ id: string; tipo: string }>) {
  const e = env();
  if (!e.APP_SECRET || !e.APP_URL) {
    throw new PostError("Para publicar pelo Metricool, configure APP_URL (endereço público do app) e APP_SECRET.");
  }
  const base = new URL(e.APP_URL);
  if (["localhost", "127.0.0.1"].includes(base.hostname)) {
    throw new PostError("O Metricool não consegue baixar mídias de localhost. Publique o app num endereço público e ajuste APP_URL.");
  }
  const expires = new Date(post.scheduled_at).getTime() + 7 * 86400_000;
  return media.map((m) => `${base.origin}/api/public/media/${signMediaToken(m.id, expires, e.APP_SECRET!)}.${m.tipo === "video" ? "mp4" : "jpg"}`);
}

/**
 * Confirmação de um dono ou gerente. Com Metricool configurado, o post vai
 * para o planejador e é publicado automaticamente na hora marcada. Sem ele, o
 * post fica na agenda como lembrete de publicação manual.
 */
export async function confirmPost(brandId: string, userId: string, id: string): Promise<ScheduledPost> {
  const post = await getPost(id, brandId);
  if (!post) throw notFound("Post não encontrado.");

  if (post.pending_action === "cancelar") {
    if (post.delivery === "metricool" && post.external_id) {
      await deleteScheduledPost(post.external_id, (await integrationsBlogId()) ?? undefined);
    }
    await logActivity(userId, "post_cancelado", "scheduled_posts", id);
    return (await queryOne<ScheduledPost>(
      `UPDATE scheduled_posts SET status = 'cancelado', pending_action = NULL, updated_at = now() WHERE id = $1 RETURNING *`, [id]))!;
  }
  if (post.status !== "rascunho" && post.status !== "falhou") throw new PostError(`Este post já está ${post.status}.`);

  const media = await mediaInfo(brandId, post.media_ids);
  const problems = postProblems({ type: post.post_type, media, caption: post.caption, hashtags: post.hashtags, networks: post.networks, scheduledAt: new Date(post.scheduled_at) });
  if (problems.length) throw new PostError(problems.join(" "));

  const blogId = await integrationsBlogId();
  const mc = metricoolConfig(blogId);
  if (!mc?.blogId) {
    const done = (await queryOne<ScheduledPost>(
      `UPDATE scheduled_posts SET status = 'agendado', delivery = 'manual', confirmed_by = $1, confirmed_at = now(), external_error = NULL,
              updated_at = now() WHERE id = $2 RETURNING *`, [userId, id]))!;
    await logActivity(userId, "post_confirmado_manual", "scheduled_posts", id);
    return done;
  }

  try {
    let urls = publicMediaUrls(post, media);
    urls = await Promise.all(urls.map((u, i) => (media[i].tipo === "image" ? normalizeImageUrl(u, mc.blogId) : Promise.resolve(u))));
    const body = metricoolPayload({
      type: post.post_type, networks: post.networks, caption: post.caption, hashtags: post.hashtags, firstComment: post.first_comment,
      localDateTime: utcToLocal(new Date(post.scheduled_at), post.timezone), timezone: post.timezone, mediaUrls: urls,
    });
    let externalId = post.external_id;
    if (externalId) await updateScheduledPost(externalId, body, mc.blogId);
    else externalId = await createScheduledPost(body, mc.blogId);
    const done = (await queryOne<ScheduledPost>(
      `UPDATE scheduled_posts SET status = 'agendado', delivery = 'metricool', external_id = $1, external_error = NULL,
              confirmed_by = $2, confirmed_at = now(), updated_at = now() WHERE id = $3 RETURNING *`, [externalId, userId, id]))!;
    await logActivity(userId, "post_agendado_metricool", "scheduled_posts", id, { externo: externalId });
    return done;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("agendamento_falhou", { id, err: message });
    await query(`UPDATE scheduled_posts SET status = 'falhou', external_error = $1, updated_at = now() WHERE id = $2`, [message.slice(0, 500), id]);
    if (err instanceof PostError) throw err;
    throw new PostError(`O Metricool não aceitou o post: ${message.slice(0, 300)}`);
  }
}

export async function markPublished(brandId: string, userId: string, id: string) {
  const post = await getPost(id, brandId);
  if (!post) throw notFound("Post não encontrado.");
  if (post.status !== "agendado") throw new PostError("Só posts agendados podem ser marcados como publicados.");
  await logActivity(userId, "post_publicado_manual", "scheduled_posts", id);
  return (await queryOne<ScheduledPost>(`UPDATE scheduled_posts SET status = 'publicado', updated_at = now() WHERE id = $1 RETURNING *`, [id]))!;
}

async function integrationsBlogId(): Promise<string | null> {
  const brand = await getBrand();
  return brand.integrations?.metricool_blog_id || env().METRICOOL_BLOG_ID || null;
}

/** Posts com dados das mídias, para a tela e para a IA. */
export async function listPosts(brandId: string, fromIso?: string | null, toIso?: string | null, ids?: string[]) {
  const posts = await query<ScheduledPost>(
    `SELECT * FROM scheduled_posts WHERE brand_id = $1
        AND ($2::timestamptz IS NULL OR scheduled_at >= $2) AND ($3::timestamptz IS NULL OR scheduled_at <= $3)
        AND ($4::uuid[] IS NULL OR id = ANY($4))
      ORDER BY scheduled_at LIMIT 300`,
    [brandId, fromIso ?? null, toIso ?? null, ids?.length ? ids : null],
  );
  const allIds = [...new Set(posts.flatMap((p) => p.media_ids))];
  const media = await mediaInfo(brandId, allIds);
  return posts.map((p) => ({
    ...p,
    local: utcToLocal(new Date(p.scheduled_at), p.timezone),
    when: describeLocal(new Date(p.scheduled_at), p.timezone),
    media: p.media_ids.map((id) => media.find((m) => m.id === id)).filter(Boolean),
  }));
}
export type PostView = Awaited<ReturnType<typeof listPosts>>[number];

export async function postView(brandId: string, id: string) {
  return (await listPosts(brandId, null, null, [id]))[0] ?? null;
}
