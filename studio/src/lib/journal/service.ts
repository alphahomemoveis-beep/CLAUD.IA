import "server-only";
import { text as llm } from "../ai";
import { EditorialSchema, type Editorial } from "../ai/schemas";
import { query, queryOne } from "../db";
import { env } from "../env";
import { log } from "../logger";
import { effectiveAI, type Brand } from "../repo/brand";
import { competitors, listScheduledPosts, metricoolConfig, timeline } from "../social/metricool";
import { instagramDaily, windsorConfigured } from "../social/windsor";
import { utcToLocal } from "../agenda/time";
import { dataBlock } from "../studio/rules";
import { addDays, computeKpis, fmtPct, ranking, type DayRow } from "./compute";

const today = () => utcToLocal(new Date(), env().APP_TIMEZONE).slice(0, 10);

/** Perfil da própria marca, criado na primeira sincronização. */
async function ownProfile(brand: Brand, handle?: string | null) {
  const h = (handle || brand.integrations?.instagram_handle || brand.identity?.instagram || brand.name).replace(/^@/, "").toLowerCase();
  const existing = await queryOne<{ id: string }>(`SELECT id FROM tracked_profiles WHERE brand_id = $1 AND is_own LIMIT 1`, [brand.id]);
  if (existing) return existing.id;
  return (await queryOne<{ id: string }>(
    `INSERT INTO tracked_profiles (brand_id, handle, display_name, is_own) VALUES ($1,$2,$3,true)
     ON CONFLICT (brand_id, network, handle) DO UPDATE SET is_own = true RETURNING id`,
    [brand.id, h, brand.name],
  ))!.id;
}

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

async function upsertMetric(profileId: string, day: string, source: string, m: Partial<Record<"followers" | "reach" | "impressions" | "views" | "profile_views" | "interactions" | "posts", number | null>>, raw?: unknown) {
  await query(
    `INSERT INTO profile_metrics (profile_id, day, source, followers, reach, impressions, views, profile_views, interactions, posts, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (profile_id, day, source) DO UPDATE SET
       followers = COALESCE(EXCLUDED.followers, profile_metrics.followers), reach = COALESCE(EXCLUDED.reach, profile_metrics.reach),
       impressions = COALESCE(EXCLUDED.impressions, profile_metrics.impressions), views = COALESCE(EXCLUDED.views, profile_metrics.views),
       profile_views = COALESCE(EXCLUDED.profile_views, profile_metrics.profile_views),
       interactions = COALESCE(EXCLUDED.interactions, profile_metrics.interactions), posts = COALESCE(EXCLUDED.posts, profile_metrics.posts),
       raw = COALESCE(EXCLUDED.raw, profile_metrics.raw), synced_at = now()`,
    [profileId, day, source, m.followers ?? null, m.reach ?? null, m.impressions ?? null, m.views ?? null, m.profile_views ?? null,
     m.interactions ?? null, m.posts ?? null, raw ? JSON.stringify(raw).slice(0, 4000) : null],
  );
}

async function record(brandId: string, source: string, ok: boolean, rows: number, message: string) {
  await query(`INSERT INTO sync_runs (brand_id, source, ok, rows, message) VALUES ($1,$2,$3,$4,$5)`, [brandId, source, ok, rows, message.slice(0, 500)]);
}

export async function syncWindsor(brand: Brand, days = 120) {
  if (!windsorConfigured()) return { ok: false, rows: 0, message: "Windsor.ai não configurado (WINDSOR_API_KEY)." };
  try {
    const end = today();
    const rows = await instagramDaily(addDays(end, -days), end);
    const byDay = new Map<string, Record<string, number | null>>();
    let handle: string | null = null;
    for (const r of rows) {
      handle ??= (r.user_name as string | undefined) ?? null;
      const cur = byDay.get(r.date) ?? {};
      const pick = (k: string, v: unknown) => { const n = num(v); if (n != null) cur[k] = Math.max(cur[k] ?? 0, n); };
      pick("followers", r.followers_count); pick("reach", r.reach); pick("impressions", r.impressions);
      pick("views", r.views); pick("profile_views", r.profile_views); pick("interactions", r.total_interactions); pick("posts", r.media_count);
      byDay.set(r.date, cur);
    }
    const profileId = await ownProfile(brand, handle);
    for (const [day, m] of byDay) await upsertMetric(profileId, day, "windsor", m);
    await record(brand.id, "windsor", true, byDay.size, `${byDay.size} dias sincronizados`);
    return { ok: true, rows: byDay.size, message: `${byDay.size} dias do Instagram sincronizados.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await record(brand.id, "windsor", false, 0, message);
    return { ok: false, rows: 0, message };
  }
}

/** Nomes das séries no Metricool. Ajuste com METRICOOL_TIMELINE_METRICS="followers:igFollowers,reach:igReach". */
function metricoolMetricMap(): Record<string, string> {
  const raw = process.env.METRICOOL_TIMELINE_METRICS;
  const map: Record<string, string> = { followers: "followers", reach: "reach", impressions: "impressions" };
  for (const pair of raw?.split(",") ?? []) {
    const [k, v] = pair.split(":").map((s) => s.trim());
    if (k && v) map[k] = v;
  }
  return map;
}

export async function syncMetricool(brand: Brand, days = 120) {
  const cfg = metricoolConfig(brand.integrations?.metricool_blog_id);
  if (!cfg?.blogId) return { ok: false, rows: 0, message: "Metricool não configurado (token, userId e blogId)." };
  const messages: string[] = [];
  let total = 0;
  const end = today();
  const ymd = (d: string) => d.replace(/-/g, "");
  try {
    const profileId = await ownProfile(brand);
    for (const [field, metric] of Object.entries(metricoolMetricMap())) {
      try {
        const series = await timeline(metric, ymd(addDays(end, -days)), ymd(end), cfg.blogId);
        for (const p of series) await upsertMetric(profileId, p.day, "metricool", { [field]: Math.round(p.value) });
        total += series.length;
      } catch (err) {
        messages.push(`${metric}: ${(err as Error).message.slice(0, 120)}`);
      }
    }
    try {
      const comps = await competitors("instagram", cfg.blogId);
      for (const c of comps) {
        const prof = (await queryOne<{ id: string }>(
          `INSERT INTO tracked_profiles (brand_id, handle, display_name, metricool_competitor_id) VALUES ($1,lower($2),$3,$4)
           ON CONFLICT (brand_id, network, handle) DO UPDATE SET metricool_competitor_id = EXCLUDED.metricool_competitor_id,
             display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), tracked_profiles.display_name) RETURNING id`,
          [brand.id, c.handle, c.name, c.id],
        ))!;
        if (c.followers != null) await upsertMetric(prof.id, end, "metricool", { followers: c.followers });
      }
      messages.push(`${comps.length} concorrentes atualizados`);
      total += comps.length;
    } catch (err) {
      messages.push(`concorrentes: ${(err as Error).message.slice(0, 120)}`);
    }
    const ok = total > 0;
    await record(brand.id, "metricool", ok, total, messages.join("; ") || "ok");
    return { ok, rows: total, message: messages.join("; ") || "Sincronizado." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await record(brand.id, "metricool", false, 0, message);
    return { ok: false, rows: 0, message };
  }
}

/** Marca como publicados os posts que o Metricool já publicou. */
export async function syncPostStatuses(brand: Brand) {
  const cfg = metricoolConfig(brand.integrations?.metricool_blog_id);
  if (!cfg?.blogId) return { updated: 0 };
  const pending = await query<{ id: string; external_id: string; scheduled_at: string }>(
    `SELECT id, external_id, scheduled_at FROM scheduled_posts
      WHERE brand_id = $1 AND status = 'agendado' AND delivery = 'metricool' AND external_id IS NOT NULL AND scheduled_at < now()`, [brand.id]);
  if (!pending.length) return { updated: 0 };
  const tz = env().APP_TIMEZONE;
  const from = utcToLocal(new Date(Math.min(...pending.map((p) => new Date(p.scheduled_at).getTime())) - 86400_000), tz);
  const to = utcToLocal(new Date(), tz);
  try {
    const remote = await listScheduledPosts(from, to, tz, cfg.blogId);
    let updated = 0;
    for (const p of pending) {
      const r = remote.find((x) => x.id === p.external_id);
      if (r?.published) { await query(`UPDATE scheduled_posts SET status = 'publicado', updated_at = now() WHERE id = $1`, [p.id]); updated++; }
      else if (r?.failed) { await query(`UPDATE scheduled_posts SET status = 'falhou', external_error = 'O Metricool informou erro na publicação.', updated_at = now() WHERE id = $1`, [p.id]); updated++; }
    }
    return { updated };
  } catch (err) {
    log.warn("sincronizar_posts_falhou", { err });
    return { updated: 0 };
  }
}

/** Uma linha por dia juntando as fontes: Windsor tem prioridade, depois Metricool, depois manual. */
async function dailyRows(profileId: string, from: string, to: string): Promise<DayRow[]> {
  return query<DayRow>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day,
       (array_agg(followers ORDER BY CASE source WHEN 'windsor' THEN 1 WHEN 'metricool' THEN 2 ELSE 3 END) FILTER (WHERE followers IS NOT NULL))[1]::float AS followers,
       (array_agg(reach ORDER BY CASE source WHEN 'windsor' THEN 1 WHEN 'metricool' THEN 2 ELSE 3 END) FILTER (WHERE reach IS NOT NULL))[1]::float AS reach,
       (array_agg(impressions ORDER BY CASE source WHEN 'windsor' THEN 1 WHEN 'metricool' THEN 2 ELSE 3 END) FILTER (WHERE impressions IS NOT NULL))[1]::float AS impressions,
       (array_agg(views ORDER BY CASE source WHEN 'windsor' THEN 1 WHEN 'metricool' THEN 2 ELSE 3 END) FILTER (WHERE views IS NOT NULL))[1]::float AS views,
       (array_agg(profile_views ORDER BY CASE source WHEN 'windsor' THEN 1 WHEN 'metricool' THEN 2 ELSE 3 END) FILTER (WHERE profile_views IS NOT NULL))[1]::float AS profile_views,
       (array_agg(interactions ORDER BY CASE source WHEN 'windsor' THEN 1 WHEN 'metricool' THEN 2 ELSE 3 END) FILTER (WHERE interactions IS NOT NULL))[1]::float AS interactions
     FROM profile_metrics WHERE profile_id = $1 AND day BETWEEN $2 AND $3 GROUP BY day ORDER BY day`,
    [profileId, from, to],
  );
}

export async function buildJournal(brand: Brand, days: number) {
  const end = today();
  const from = addDays(end, -(days * 2 + 2));
  const profiles = await query<{ id: string; handle: string; display_name: string; is_own: boolean }>(
    `SELECT id, handle, display_name, is_own FROM tracked_profiles WHERE brand_id = $1 ORDER BY is_own DESC, handle`, [brand.id]);
  const own = profiles.find((p) => p.is_own);
  const ownRows = own ? await dailyRows(own.id, from, end) : [];
  const k = computeKpis(ownRows, end, days);
  const rank = ranking(await Promise.all(profiles.map(async (p) => ({
    id: p.id, handle: p.handle, name: p.display_name, is_own: p.is_own,
    rows: (await dailyRows(p.id, from, end)).map((r) => ({ day: r.day, followers: r.followers })),
  }))), end, days);
  const posts = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM scheduled_posts WHERE brand_id = $1 AND scheduled_at::date BETWEEN $2 AND $3 GROUP BY status`,
    [brand.id, k.periodo.start, end]);
  const upcoming = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM scheduled_posts WHERE brand_id = $1 AND status = 'agendado' AND scheduled_at BETWEEN now() AND now() + interval '7 days'`, [brand.id]);
  const syncs = await query<{ source: string; ok: boolean; message: string; created_at: string }>(
    `SELECT DISTINCT ON (source) source, ok, message, created_at FROM sync_runs WHERE brand_id = $1 ORDER BY source, created_at DESC`, [brand.id]);
  const edition = await queryOne<{ editorial: Editorial; created_at: string }>(
    `SELECT editorial, created_at FROM journal_editions WHERE brand_id = $1 AND period_days = $2 ORDER BY created_at DESC LIMIT 1`, [brand.id, days]);
  return {
    days, end, own: own ? { handle: own.handle } : null, kpis: k, ranking: rank, profiles,
    posts: Object.fromEntries(posts.map((p) => [p.status, p.n])), upcoming: upcoming?.n ?? 0,
    sources: {
      windsor: { configured: windsorConfigured(), last: syncs.find((s) => s.source === "windsor") ?? null },
      metricool: { configured: !!metricoolConfig(brand.integrations?.metricool_blog_id)?.blogId, last: syncs.find((s) => s.source === "metricool") ?? null },
    },
    edition,
  };
}
export type Journal = Awaited<ReturnType<typeof buildJournal>>;

/** O Claude escreve a edição só com os números calculados aqui. */
export async function writeEditorial(brand: Brand, userId: string, j: Journal): Promise<Editorial> {
  const cfg = effectiveAI(brand);
  const resumo = {
    periodo: `${j.kpis.periodo.start} a ${j.kpis.periodo.end} (${j.days} dias), comparado com ${j.kpis.periodo.prevStart} a ${j.kpis.periodo.prevEnd}`,
    kpis: {
      seguidores: { ...j.kpis.seguidores, variacao_pct_texto: fmtPct(j.kpis.seguidores.variacao_pct) },
      alcance: j.kpis.reach, impressoes: j.kpis.impressions, visualizacoes: j.kpis.views, visitas_ao_perfil: j.kpis.profile_views, interacoes: j.kpis.interactions,
    },
    ranking: j.ranking.map((r) => ({ posicao: r.posicao, perfil: `@${r.handle}`, e_a_marca: r.is_own, seguidores: r.seguidores, crescimento_pct: r.crescimento.variacao_pct })),
    posts_no_periodo: j.posts,
    posts_agendados_proximos_7_dias: j.upcoming,
  };
  const { data } = await llm().structured({
    schemaName: "editorial",
    schema: EditorialSchema,
    model: cfg.textModel,
    system: `Você é o editor do jornal interno de redes sociais da ${brand.name} (${brand.positioning}).
Escreva em português, com tom de jornal elegante e direto, para donos e gerentes.
Regras: use SOMENTE os números do bloco de dados. Não invente números, datas nem perfis.
Quando um número for null, diga que ainda não há dado. Cite variações com o sinal, ex.: "+2,5%".
As recomendações devem ser práticas: formato, horário, tipo de ambiente, frequência.`,
    messages: [{ role: "user", text: `Dados da edição:\n${dataBlock(resumo)}` }],
  });
  await query(
    `INSERT INTO journal_editions (brand_id, period_days, period_end, data, editorial, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [brand.id, j.days, j.end, JSON.stringify(resumo), JSON.stringify(data), userId]);
  return data;
}
