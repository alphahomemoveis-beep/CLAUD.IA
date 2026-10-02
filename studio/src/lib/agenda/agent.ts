import "server-only";
import { z } from "zod";
import { text as llm } from "../ai";
import { query } from "../db";
import { getBrand } from "../repo/brand";
import { addMessage, listMessages, type Message } from "../repo/projects";
import { folderPaths, searchMedia, STAGES } from "../repo/folders";
import { metricoolConfig } from "../social/metricool";
import { buildBrandMemory } from "../studio/context";
import { effectiveAI } from "../repo/brand";
import { createDraft, listPosts, requestCancel, timezone, updatePost, type PostView } from "./posts";
import { describeLocal, localToUtc, utcToLocal } from "./time";
import { NETWORKS, POST_TYPES } from "./rules";
import type { AgentTool } from "../ai/types";

const LocalDT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "use AAAA-MM-DDTHH:MM:SS");

function tools(ctx: { brandId: string; userId: string; conversationId: string; touched: Set<string> }): AgentTool[] {
  const tz = timezone();
  return [
    {
      name: "listar_pastas",
      description: "Lista todas as pastas de obras com o caminho completo (ex.: 'Condomínio La Paloma / Casa 12') e quantas mídias cada uma tem.",
      schema: z.object({}),
      run: async () => ({ pastas: await folderPaths(ctx.brandId) }),
    },
    {
      name: "buscar_midias",
      description: "Procura fotos e vídeos nas pastas pelo nome da pasta, do condomínio, da casa, legenda ou nome do arquivo. Use sempre antes de criar um post, para pegar o id da mídia.",
      schema: z.object({
        consulta: z.string().describe("Palavras do pedido, ex.: 'La Paloma casa 12'"),
        etapa: z.enum(STAGES).nullable().describe("projeto, obra ou resultado, se a pessoa disse"),
        tipo: z.enum(["image", "video"]).nullable().describe("video ou image, se a pessoa disse"),
        limite: z.number().int().nullable(),
      }),
      run: async (input) => {
        const i = input as { consulta: string; etapa: (typeof STAGES)[number] | null; tipo: "image" | "video" | null; limite: number | null };
        return { midias: await searchMedia(ctx.brandId, i.consulta, { stage: i.etapa, type: i.tipo, limit: Math.min(12, i.limite ?? 8) }) };
      },
    },
    {
      name: "criar_rascunho_post",
      description: `Cria o RASCUNHO de um post agendado. Nada é publicado: um dono ou gerente confirma no cartão. Hora local no fuso ${tz}.`,
      schema: z.object({
        midia_ids: z.array(z.string()).describe("ids vindos de buscar_midias, na ordem do post"),
        data_hora_local: LocalDT.describe(`Data e hora no fuso ${tz}, ex.: 2026-10-03T19:00:00`),
        tipo: z.enum(POST_TYPES).describe("REEL para um vídeo, POST para uma foto, CARROSSEL para 2 a 10 mídias, STORY"),
        legenda: z.string().describe("Legenda pronta, no tom da marca, sem as hashtags"),
        hashtags: z.array(z.string()).describe("De 5 a 15 hashtags relevantes"),
        primeiro_comentario: z.string().nullable(),
        redes: z.array(z.enum(NETWORKS)).describe("Padrão: instagram"),
      }),
      run: async (input) => {
        const i = input as { midia_ids: string[]; data_hora_local: string; tipo: (typeof POST_TYPES)[number]; legenda: string; hashtags: string[]; primeiro_comentario: string | null; redes: string[] };
        const post = await createDraft(ctx.brandId, ctx.userId, ctx.conversationId, {
          mediaIds: i.midia_ids, localDateTime: i.data_hora_local, type: i.tipo, caption: i.legenda, hashtags: i.hashtags,
          firstComment: i.primeiro_comentario, networks: i.redes.length ? i.redes : ["instagram"],
        });
        ctx.touched.add(post.id);
        return { id: post.id, status: post.status, quando: describeLocal(new Date(post.scheduled_at), tz), hashtags: post.hashtags };
      },
    },
    {
      name: "listar_posts",
      description: "Lista os posts da agenda num período (hora local). Sem período: dos últimos 7 dias até 60 dias à frente.",
      schema: z.object({ de: LocalDT.nullable(), ate: LocalDT.nullable() }),
      run: async (input) => {
        const i = input as { de: string | null; ate: string | null };
        const from = i.de ? localToUtc(i.de, tz) : new Date(Date.now() - 7 * 86400_000);
        const to = i.ate ? localToUtc(i.ate, tz) : new Date(Date.now() + 60 * 86400_000);
        const posts = await listPosts(ctx.brandId, from.toISOString(), to.toISOString());
        return { posts: posts.filter((p) => p.status !== "cancelado").map(summarize) };
      },
    },
    {
      name: "alterar_post",
      description: "Altera um post existente (horário, legenda, hashtags, tipo, mídias). Um post já agendado volta a rascunho e precisa de nova confirmação.",
      schema: z.object({
        id: z.string(),
        data_hora_local: LocalDT.nullable(),
        legenda: z.string().nullable(),
        hashtags: z.array(z.string()).nullable(),
        tipo: z.enum(POST_TYPES).nullable(),
        midia_ids: z.array(z.string()).nullable(),
        primeiro_comentario: z.string().nullable(),
      }),
      run: async (input) => {
        const i = input as { id: string; data_hora_local: string | null; legenda: string | null; hashtags: string[] | null; tipo: (typeof POST_TYPES)[number] | null; midia_ids: string[] | null; primeiro_comentario: string | null };
        const post = await updatePost(ctx.brandId, ctx.userId, i.id, {
          localDateTime: i.data_hora_local ?? undefined, caption: i.legenda ?? undefined, hashtags: i.hashtags ?? undefined,
          type: i.tipo ?? undefined, mediaIds: i.midia_ids ?? undefined, firstComment: i.primeiro_comentario ?? undefined,
        });
        ctx.touched.add(post.id);
        return { id: post.id, status: post.status, quando: describeLocal(new Date(post.scheduled_at), tz) };
      },
    },
    {
      name: "pedir_cancelamento",
      description: "Cancela um rascunho na hora. Para um post já agendado, cria um pedido de cancelamento que um dono ou gerente confirma.",
      schema: z.object({ id: z.string() }),
      run: async (input) => {
        const post = await requestCancel(ctx.brandId, ctx.userId, (input as { id: string }).id);
        ctx.touched.add(post.id);
        return { id: post.id, status: post.status, aguardando_confirmacao: post.pending_action === "cancelar" };
      },
    },
    {
      name: "resumo_metricas",
      description: "Números recentes do Instagram da marca guardados no jornal (seguidores, alcance) para embasar sugestões de horário e conteúdo.",
      schema: z.object({}),
      run: async () => {
        const rows = await query(
          `SELECT pm.day, pm.followers, pm.reach, pm.impressions, pm.views FROM profile_metrics pm
             JOIN tracked_profiles tp ON tp.id = pm.profile_id
            WHERE tp.brand_id = $1 AND tp.is_own ORDER BY pm.day DESC LIMIT 14`, [ctx.brandId]);
        return { ultimos_dias: rows, observacao: rows.length ? "" : "Ainda não há métricas sincronizadas." };
      },
    },
  ];
}

function summarize(p: PostView) {
  return {
    id: p.id, status: p.status, aguardando_cancelamento: p.pending_action === "cancelar", tipo: p.post_type, redes: p.networks,
    quando: p.when, hora_local: p.local, legenda: p.caption.slice(0, 160), midias: p.media.map((m) => `${m!.pasta} · ${m!.etapa} · ${m!.tipo}`),
  };
}

/** Mensagem na agenda: o Claude entende o pedido, usa as ferramentas e propõe rascunhos. */
export async function handleAgendaMessage(userId: string, conversationId: string, textIn: string, attached: string[]): Promise<Message[]> {
  const brand = await getBrand();
  const cfg = effectiveAI(brand);
  const tz = timezone();
  const now = new Date();
  const out: Message[] = [];
  const userText = attached.length ? `${textIn}\n\n[Mídias anexadas: ${attached.join(", ")}]` : textIn;
  out.push(await addMessage(conversationId, "user", "text", userText, attached.length ? { attached } : null));

  const memory = await buildBrandMemory(brand, null);
  const delivery = metricoolConfig(brand.integrations?.metricool_blog_id)?.blogId ? "Metricool (publicação automática)" : "manual (a equipe publica e marca como publicado)";
  const system = `${memory}

## AGENDA DE POSTS
Você é o assistente de agenda de posts da ${brand.name}. Donos e gerentes falam com você em linguagem natural:
"coloca o vídeo da obra da Casa 12 do La Paloma para sexta às 19h". Seu trabalho:
1. Encontrar a mídia certa com buscar_midias (ou usar as mídias anexadas, cujos ids vêm na mensagem).
2. Entender data e hora no fuso ${tz}. "Sexta" é a próxima sexta-feira. Sem horário dito, sugira o melhor horário
   (para o público de alto padrão, em geral entre 18h e 21h em dias úteis) e diga que foi uma sugestão.
3. Escrever a legenda no tom da marca: elegante, curta, com chamada para o Direct, sem exagero. E de 5 a 15 hashtags.
4. Criar o RASCUNHO com criar_rascunho_post. Nunca diga que o post foi agendado: diga que o rascunho está pronto
   e que um dono ou gerente precisa confirmar no cartão ao lado.
Regras:
- Vídeo vira REEL; uma foto vira POST; várias fotos viram CARROSSEL; STORY só quando pedirem.
- Se houver mais de uma mídia possível e o pedido for ambíguo, mostre as opções (pasta, etapa, data) e pergunte.
- Se não encontrar a mídia, diga isso e peça para enviar em 🗂️ Pastas. Não invente ids.
- Publicação nesta conta: ${delivery}.
- O pedido pode vir de voz transcrita: sem pontuação, números por extenso ("dezenove horas", "dia três") e erros
  de transcrição (ex.: "Alfa Romeo" ou "alfa rôme" quer dizer AlphaHome; "la paloma" pode vir como "lá paloma").
  Interprete com bom senso e, se algo importante ficar ambíguo, pergunte.
- Responda em português, em poucas frases curtas, porque a resposta pode ser lida em voz alta.`;

  const history = (await listMessages(conversationId))
    .filter((m) => m.role !== "system" && m.content)
    .slice(-16, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", text: m.content.slice(0, 3000) }));
  const touched = new Set<string>();
  const result = await llm().agent({
    system,
    model: cfg.textModel,
    effort: "medium",
    maxSteps: 8,
    tools: tools({ brandId: brand.id, userId, conversationId, touched }),
    messages: [...history, { role: "user", text: `AGORA: ${describeLocal(now, tz)} (${utcToLocal(now, tz)}, fuso ${tz})\n${userText}` }],
  });

  out.push(await addMessage(conversationId, "assistant", "agenda", result.text || "Pronto.", {
    postIds: [...touched],
    tools: result.toolCalls.map((c) => ({ name: c.name, error: c.error ?? null })),
  }));
  await query(`UPDATE conversations SET title = CASE WHEN title = 'Nova conversa' THEN $1 ELSE title END WHERE id = $2`,
    [`Agenda · ${textIn.slice(0, 60)}`, conversationId]);
  return out;
}
