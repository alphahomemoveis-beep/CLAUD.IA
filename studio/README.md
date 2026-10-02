# AlphaHome Creative Studio

Plataforma privada de direção criativa da AlphaHome Ambientes Planejados. A marca é configurada uma vez e
todo chat novo já sabe quem é a AlphaHome, qual é a estética, quais referências usar e o que evitar.

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

## Arquitetura

- **Frontend e backend:** Next.js 16 (App Router) com TypeScript. As rotas em `src/app/api` são o backend.
- **IA:** interface única `AIProvider` em `src/lib/ai/types.ts`.
  - `openai-provider.ts` usa a Responses API com saída estruturada estrita (`json_schema`), a ferramenta
    `web_search`, entrada de imagem para análise das referências, a Image API para gerar e editar imagens
    e a Embeddings API.
  - `mock-provider.ts` responde sem chamar nada, para testar o fluxo e a interface sem custo.
  - Os modelos são configuráveis por variável de ambiente e pela tela Configurações. Trocar de empresa
    é escrever outro provedor com a mesma interface.
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

## Como rodar

Requisitos: Node 22 e PostgreSQL 15+ com pgvector.

```bash
cd studio
npm install
cp .env.example .env.local          # preencha DATABASE_URL e OPENAI_API_KEY
docker compose up -d                # opcional: banco local com pgvector
npm run db:migrate
SEED_ADMIN_EMAIL=voce@exemplo.com SEED_ADMIN_PASSWORD='umaSenhaForte123' npm run db:seed
npm run dev                         # http://localhost:3000
```

Para testar sem a OpenAI, use `AI_PROVIDER=mock`. As imagens viram marcadores de teste e a pesquisa avisa que é simulada.

Se o banco não for o do docker-compose, crie as extensões como superusuário antes da migração (`db/init-extensions.sql`).
No Supabase, ative `vector` e `pgcrypto` em Database > Extensions.

### Verificações

```bash
npm run typecheck
npm test
npm run build
```

## Produção

- A chave da OpenAI fica só em variável de ambiente do servidor. Nada com credencial vai para o navegador.
- Em hospedagem sem disco persistente (Vercel e similares), use `STORAGE_DRIVER=supabase`.
- As rotas de IA declaram até 300 segundos de execução. Confira o limite do seu plano de hospedagem.
- O limite de requisições fica em memória, por instância. Com várias instâncias, troque por Redis.
- Defina `APP_URL` com o endereço público: ele entra na checagem de origem contra CSRF.

## Modelos padrão

| Uso | Variável | Padrão |
|---|---|---|
| Texto, planejamento e pesquisa | `AI_TEXT_MODEL` | `gpt-5.5` |
| Análise de referências | `AI_VISION_MODEL` | `gpt-5.5` |
| Imagem | `AI_IMAGE_MODEL` | `gpt-image-2.5-sunburst` |
| Embeddings | `AI_EMBEDDING_MODEL` | `text-embedding-3-small` |

Os nomes vêm dos tipos do SDK oficial `openai` 7.27. Para imagens 4:5 e 9:16 o app pede tamanhos livres
(1088x1360 e 1088x1936), aceitos pela família GPT Image 2. Em modelos mais antigos ele cai para 1024x1536.

## Limitações conhecidas

- A integração com a OpenAI foi verificada por tipos e por esquema, mas não com chamadas reais: este
  ambiente de desenvolvimento não tinha chave. O fluxo completo foi testado com o provedor de teste.
- Vídeos entram na biblioteca, mas a análise automática é só para imagens. Descreva o vídeo nas notas.
- A geração é síncrona, uma peça por requisição. Para filas longas, mova a geração para um worker.
