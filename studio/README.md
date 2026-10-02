# AlphaHome Creative Studio

Plataforma privada de direção criativa da AlphaHome Ambientes Planejados. A marca é configurada uma vez e
todo chat novo já sabe quem é a AlphaHome, qual é a estética, quais referências usar e o que evitar.

O cérebro do estúdio é o **Claude** (Anthropic). Além do estúdio criativo, o app tem:

- **🗂️ Pastas de obras:** árvore livre (ex.: "Condomínio La Paloma" > "Casa 12"), cada pasta com as etapas
  **Projeto**, **Obra** e **Resultado** para fotos e vídeos.
- **📅 Agenda de posts por conversa:** "coloca o vídeo do resultado da Casa 12 para sexta às 19h". O Claude acha a
  mídia nas pastas, escreve legenda e hashtags e cria um rascunho. Um dono ou gerente confirma, e o post vai para o
  Metricool, que publica na hora marcada.
- **🎙️ Falar com a agenda:** botão de microfone na aba de agendar posts. O que você fala vira o pedido e é enviado
  ao terminar. Opcionalmente, a resposta é lida em voz alta. Usa o reconhecimento de voz do navegador, em
  português: funciona no Chrome, Edge e Safari, em HTTPS. Não funciona no Firefox.
- **📈 Instagram ao vivo:** widget com seguidores, alcance, visualizações, ranking e próximo post. Aparece na tela
  inicial e na agenda e tem página própria em `/widget`, que pode ser fixada no celular pela opção "Adicionar à
  tela inicial". Atualiza a cada 3 horas: o navegador pede de novo a cada 3 horas, e o servidor só consulta
  Windsor.ai e Metricool quando os dados passaram de 3 horas.
- **📰 Jornal:** seguidores, alcance, visualizações, visitas e interações com setas de alta e queda contra o período
  anterior, ranking de seguidores com concorrentes e um editorial escrito pelo Claude só com os números calculados.
- **Login:** primeiro acesso em `/primeiro-acesso`, papéis Dono, Gerente e Leitura, troca de senha.

> A IA propõe. Você escolhe. A IA executa. Nunca inverter essa ordem.

## Fluxo

```
Pedido livre ("Crie um carrossel sobre praticidade")
  > análise do pedido (tipo, tema, público, objetivo, ambiente, estética)
  > pesquisa de mercado na web (tendência atual x referência histórica)
  > recuperação das referências aprovadas da biblioteca (embeddings + pgvector)
  > 3 a 5 conceitos                         ← a pessoa escolhe
  > planejamento completo                   ← "Aprovar planejamento?"
  > prompt final + checklist de qualidade (revisa o prompt até 2 vezes se reprovar)
  > geração de cada peça como imagem independente
  > feedback 👍 👎 ⭐ ✏️ > preferências da marca > próximas criações
```

## Regras que o código garante

Estas regras não dependem só do prompt. O servidor recusa o que as viola.

| Regra | Onde |
|---|---|
| Nenhuma imagem antes da escolha do conceito e da aprovação do planejamento | `src/lib/studio/workflow.ts`, conferido em toda geração por `generation.ts` |
| A peça só é gerada pelo planejamento aprovado mais recente | `src/lib/studio/generation.ts` |
| Uma arte = um conceito = um ambiente principal, salvo pedido explícito | `environments.ts` e `guards.ts`; o conceito ou plano é refeito se misturar |
| Carrossel: cada slide é uma geração separada | uma linha em `generated_images` e uma chamada por peça |
| Tendência atual só com fonte citada pela busca na web | `guards.ts`; o resto vira referência histórica |
| Editar o Prompt Mestre cria versão nova; apagar exige digitar a versão | `api/master-prompts`, `api/prompt-versions` |
| Feedback com comentário vira preferência reaplicável | `src/lib/studio/feedback.ts` |
| A IA da agenda só cria rascunhos; publicar exige dono ou gerente | `src/lib/agenda/posts.ts` |
| Link público de mídia só com assinatura e prazo | `src/lib/social/signing.ts` |
| O editorial do jornal só usa números calculados pelo app | `src/lib/journal/service.ts` |

## Arquitetura

- **Frontend e backend:** Next.js 16 (App Router) com TypeScript. As rotas em `src/app/api` são o backend.
- **IA:** três interfaces em `src/lib/ai/types.ts`, cada uma com o seu provedor.
  - **Texto, visão, pesquisa e agente:** `anthropic-provider.ts` (padrão, modelo `claude-opus-5-5`). Usa saída
    estruturada (`output_config.format`), a busca na web do servidor da Anthropic (`web_search_20260209`), imagens
    em base64 para analisar referências e ferramentas com `strict: true` para a agenda. Recusas por segurança
    são reencaminhadas pela API com `fallbacks: "default"`.
  - **Imagem:** o Claude não gera imagens. O padrão é o modo **manual**: o app escreve o prompt final aprovado no
    checklist, você gera onde preferir e envia a peça pronta. Com `IMAGE_PROVIDER=openai` a geração é automática.
  - **Busca de referências:** sem provedor de embeddings, usa texto completo em português no PostgreSQL. Com
    `EMBEDDING_PROVIDER=voyage`, usa embeddings do Voyage AI com pgvector.
  - `mock-provider.ts` simula tudo sem custo, para testar o fluxo e a interface.
- **Memória:** PostgreSQL + pgvector. A memória da marca (`src/lib/studio/context.ts`) junta regras do
  estúdio, identidade, Prompt Mestre ativo, preferências e histórico. As referências são buscadas por
  semelhança a cada pedido. Nenhum modelo é retreinado.
- **Arquivos:** driver local ou Supabase Storage (`src/lib/storage`). Os arquivos só saem por rotas que exigem login.
- **Autenticação:** e-mail e senha com hash scrypt, sessão em cookie httpOnly, papéis dono, editor e leitura.

### Banco de dados

Migração em `db/migrations/001_init.sql`. Tabelas pedidas no briefing:
`users`, `brand_settings`, `master_prompts`, `prompt_versions`, `visual_references`, `visual_embeddings`,
`reference_tags`, `creative_projects`, `conversations`, `messages`, `concepts`, `creative_plans`,
`generated_images`, `feedback`, `brand_preferences`. Além delas: `sessions`, `activity_logs` e `schema_migrations`.

Todas as tabelas de conteúdo apontam para `brand_settings`, o que prepara o app para mais de uma marca.

## Agenda, Metricool e Windsor.ai

- **Rascunho antes de publicar:** a IA só cria rascunhos. Publicar, alterar um post já agendado e cancelar
  exigem a confirmação de um dono ou gerente. Alterar um post agendado o devolve a rascunho.
- **Regras conferidas no servidor:** Reels com um vídeo, carrossel com 2 a 10 mídias, legenda até 2.200
  caracteres com as hashtags, horário pelo menos 5 minutos no futuro. Hora local no fuso `APP_TIMEZONE`.
- **Metricool:** com `METRICOOL_USER_TOKEN`, `METRICOOL_USER_ID` e a marca (blogId) escolhida em Configurações >
  Integrações, a confirmação cria o post em `POST /v2/scheduler/posts`. As mídias vão por links temporários e
  assinados (`/api/public/media/...`), por isso o app precisa de `APP_URL` público e `APP_SECRET`. Sem Metricool,
  o post confirmado fica na agenda como lembrete de publicação manual.
- **Windsor.ai:** com `WINDSOR_API_KEY`, o jornal busca seguidores, alcance, impressões e visitas do Instagram da
  marca. O Instagram precisa estar conectado na conta do Windsor.ai.
- **Concorrentes:** os concorrentes cadastrados no Metricool entram no ranking. Perfis podem ser adicionados e
  ter números lançados à mão no próprio jornal.
- **Sincronização:** botão "Sincronizar agora" no jornal, o widget (a cada 3 horas) ou um agendador chamando
  `/api/cron/sync` com `Authorization: Bearer CRON_SECRET`. O `vercel.json` já agenda essa chamada a cada 3 horas
  na Vercel, que envia o `CRON_SECRET` sozinha. A sincronização também marca como publicados os posts que o
  Metricool já publicou.

## Como rodar

Requisitos: Node 22 e PostgreSQL 15+ com pgvector.

```bash
cd studio
npm install
cp .env.example .env.local          # preencha DATABASE_URL, ANTHROPIC_API_KEY e APP_SECRET
docker compose up -d                # opcional: banco local com pgvector
npm run db:migrate                  # em produção roda sozinho com npm run start:prod
npm run dev                         # http://localhost:3000 > crie a conta do dono no primeiro acesso
```

Para testar sem a OpenAI, use `AI_PROVIDER=mock`. As imagens viram marcadores de teste e a pesquisa avisa que é simulada.

Se o banco não for o do docker-compose, crie as extensões como superusuário antes da migração (`db/init-extensions.sql`).
No Supabase, ative `vector` em Database > Extensions e informe o certificado em `DATABASE_CA_CERT`.
A marca e o Prompt Mestre iniciais são criados sozinhos no primeiro acesso.

### Verificações

```bash
npm run typecheck
npm test
npm run build
```

## Produção

O passo a passo para publicar está em [DEPLOY.md](DEPLOY.md).


- As chaves (Anthropic, Metricool, Windsor, OpenAI) ficam só em variáveis de ambiente do servidor. Nada com
  credencial vai para o navegador.
- Em hospedagem sem disco persistente (Vercel e similares), use `STORAGE_DRIVER=supabase`.
- As rotas de IA declaram até 300 segundos de execução. Confira o limite do seu plano de hospedagem.
- O limite de requisições fica em memória, por instância. Com várias instâncias, troque por Redis.
- Defina `APP_URL` com o endereço público: ele entra na checagem de origem contra CSRF.

## Modelos padrão

| Uso | Variável | Padrão |
|---|---|---|
| Texto, planejamento, pesquisa, agenda e jornal | `AI_TEXT_MODEL` | `claude-opus-5-5` |
| Análise de referências | `AI_VISION_MODEL` | igual ao de texto |
| Imagem (só com `IMAGE_PROVIDER=openai`) | `AI_IMAGE_MODEL` | `gpt-image-2.5-sunburst` |
| Embeddings (só com `EMBEDDING_PROVIDER=voyage`) | `AI_EMBEDDING_MODEL` | `voyage-3.5` |

## Limitações conhecidas

- Nenhuma integração externa foi testada com chave real neste ambiente: não havia chave da Anthropic, e a rede
  bloqueava o Metricool. Todo o fluxo foi testado com o provedor de teste, e as falhas das integrações aparecem
  com mensagem clara.
- Os endpoints do Metricool seguem a documentação pública e um cliente de código aberto. Os nomes das séries de
  métricas variam por conta: ajuste `METRICOOL_TIMELINE_METRICS` se o jornal não trouxer dados do Metricool.
- Os campos do Windsor.ai seguem a lista pública do conector de Instagram e podem ser trocados por
  `WINDSOR_INSTAGRAM_FIELDS`.
- Vídeos entram nas pastas e na agenda, mas a análise automática da biblioteca é só para imagens.
- Envios grandes de vídeo passam pelo servidor do app. Em hospedagens com limite de corpo de requisição, use o
  Supabase Storage e ajuste `FOLDER_MAX_UPLOAD_MB`.
- O limite de requisições fica em memória, por instância. Com várias instâncias, troque por Redis.
