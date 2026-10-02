# Como publicar o AlphaHome Creative Studio

Guia para colocar o app no ar com endereço próprio, HTTPS e login. Leva cerca de uma hora na primeira vez.

## Como fica a estrutura

| Peça | Serviço | Para quê |
|---|---|---|
| App | **Railway** | Roda o site e a API. Dá o endereço com HTTPS e um disco para fotos e vídeos. |
| Banco de dados | **Supabase** | PostgreSQL com pgvector: projetos, pastas, agenda, jornal, usuários. |
| Cérebro | **Anthropic (Claude)** | Conceitos, planejamento, agenda por conversa e jornal. |
| Publicação | **Metricool** | Publica os posts confirmados na hora marcada. |
| Métricas | **Windsor.ai** | Seguidores, alcance e visitas do Instagram para o jornal e o widget. |
| Relógio | **cron-job.org** | Chama a sincronização a cada 3 horas, mesmo com o app fechado. |

Por que Railway e não Vercel: a Vercel limita cada envio a cerca de 4,5 MB, e os vídeos das pastas são maiores.
A Railway não tem esse limite e guarda os arquivos num disco persistente.

## Antes de começar

Tenha à mão:

- Acesso ao GitHub com o repositório `alphahomemoveis-beep/CLAUD.IA`.
- Um cartão para os planos pagos (Railway, créditos da Anthropic, plano do Metricool com API).
- Um gerenciador de senhas para gerar textos aleatórios longos.

## Passo 1. Levar o código para o branch padrão

O app está no branch `claude/alphahome-creative-studio-ekgn8w`. O branch padrão do repositório é
`claude/metricool-windsor-connection-oqdxfr` (não existe `main`). Abra o pull request por este link e faça o merge:

https://github.com/alphahomemoveis-beep/CLAUD.IA/compare/claude/metricool-windsor-connection-oqdxfr...claude/alphahome-creative-studio-ekgn8w?expand=1

Depois, na Railway, escolha o branch padrão para publicar. Se preferir pular o pull request, escolha direto o
branch `claude/alphahome-creative-studio-ekgn8w` na Railway.

## Passo 2. Banco de dados no Supabase

1. Crie uma conta em supabase.com e um projeto novo. Região: **South America (São Paulo)**. Guarde a senha do
   banco que você escolher.
2. Em **Database > Extensions**, ative **vector**. A extensão **pgcrypto** já vem ativa.
3. Clique em **Connect** no topo do projeto e copie a string de conexão do **Session pooler**. Ela começa com
   `postgresql://postgres.` e usa a porta `5432`. Troque `[YOUR-PASSWORD]` pela senha do banco. Este é o
   `DATABASE_URL`.
4. Em **Database > Settings > SSL Configuration**, baixe o certificado. Abra o arquivo num editor de texto e
   copie tudo, de `-----BEGIN CERTIFICATE-----` até `-----END CERTIFICATE-----`. Este é o `DATABASE_CA_CERT`.

Não é preciso rodar nada no banco: o app cria as tabelas sozinho ao iniciar.

## Passo 3. Chave do Claude (opcional)

Sem a chave, o app liga com a **IA desligada**: login, pastas, agenda com posts feitos à mão, jornal e widget
funcionam. O estúdio criativo, a agenda por conversa, a análise da biblioteca e o editorial do jornal ficam
desligados, e dá para usar o Claude no chat para essas tarefas.

Para ligar a IA do app:

1. Entre no console da Anthropic (platform.claude.com) e crie uma chave em **API Keys**.
2. Adicione créditos em **Billing** e, se quiser, um limite mensal em **Limits**.
3. Na Railway, cadastre `ANTHROPIC_API_KEY` com a chave. Para gastar menos, cadastre também
   `AI_TEXT_MODEL` = `claude-haiku-4-5`.

## Passo 4. App na Railway

1. Crie uma conta em railway.com com o GitHub e escolha um plano pago (o gratuito desliga o app).
2. **New Project > Deploy from GitHub repo** e escolha `CLAUD.IA`.
3. No serviço, em **Settings**:
   - **Root Directory:** `studio`
   - **Custom Start Command:** `npm run start:prod`
   - **Healthcheck Path:** `/login`
4. Em **Volumes**, adicione um volume com **Mount Path** `/data`. É ali que ficam fotos, vídeos e peças.
5. Em **Settings > Networking**, clique em **Generate Domain**. Anote o endereço, por exemplo
   `https://alphahome-studio.up.railway.app`. Se quiser um domínio próprio, adicione-o ali e crie o registro CNAME
   que a Railway indicar.
6. Em **Variables**, cadastre:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | a string do Session pooler (passo 2) |
| `DATABASE_CA_CERT` | o conteúdo do certificado (passo 2) |
| `ANTHROPIC_API_KEY` | só se for usar a IA do app (passo 3) |
| `IMAGE_PROVIDER` | `manual` |
| `EMBEDDING_PROVIDER` | `none` |
| `STORAGE_DRIVER` | `local` |
| `STORAGE_DIR` | `/data/uploads` |
| `APP_URL` | o endereço do item 5, com `https://` e sem barra no fim |
| `APP_SECRET` | 64 caracteres aleatórios do gerenciador de senhas |
| `CRON_SECRET` | outros 40 caracteres aleatórios |
| `APP_TIMEZONE` | `America/Sao_Paulo` |
| `FOLDER_MAX_UPLOAD_MB` | `300` |

7. Clique em **Deploy**. No log aparecem "Aplicando 001_init.sql", "Aplicando 002_pastas_agenda_jornal.sql" e
   "Ready". Se aparecer "unable to verify the first certificate", o `DATABASE_CA_CERT` está incompleto.

## Passo 5. Primeiro acesso

1. Abra o endereço do app. Ele leva sozinho para **Primeiro acesso**.
2. Crie a conta do dono com seu e-mail e uma senha forte. Essa tela só funciona uma vez.
3. O app cria a marca AlphaHome e o Prompt Mestre inicial.
4. Em **Configurações > Usuários**, convide os outros donos e os gerentes. Gerentes agendam e confirmam posts.
   Leitura só vê.

## Passo 6. Metricool (publicação automática)

1. A API exige o plano **Advanced** ou superior do Metricool.
2. No Metricool, em **Configurações da conta > API**, copie o token e o ID de usuário.
3. Na Railway, adicione `METRICOOL_USER_TOKEN` e `METRICOOL_USER_ID` e aguarde o novo deploy.
4. No app, em **Configurações > Integrações**, clique em **Buscar minhas marcas no Metricool**, escolha a
   AlphaHome e salve.
5. Teste: agende um post e confirme. Ele deve aparecer no planejador do Metricool. Se aparecer erro de mídia,
   confira se o `APP_URL` é o endereço público com `https://`.

## Passo 7. Windsor.ai (números do Instagram)

1. No Windsor.ai, conecte o **Instagram** da AlphaHome. A conta precisa ser Empresa ou Criador, ligada a uma
   página do Facebook.
2. Copie a chave da API no painel do Windsor.ai.
3. Na Railway, adicione `WINDSOR_API_KEY`.
4. No app, abra o **Jornal** e clique em **Sincronizar agora**. Os seguidores aparecem no jornal e no widget.

## Passo 8. Atualização a cada 3 horas

1. Crie uma conta gratuita em cron-job.org e um novo cron job.
2. **URL:** `https://SEU-ENDERECO/api/cron/sync`
3. **Agendamento:** a cada 3 horas.
4. Em **Advanced > Headers**, adicione `Authorization` com o valor `Bearer ` seguido do `CRON_SECRET`.
5. Salve e use **Test run**: a resposta deve ser um JSON com `windsor`, `metricool` e `posts`.

## Passo 9. Celular e microfone

- **Widget no celular:** abra `https://SEU-ENDERECO/widget`. No Safari, use **Compartilhar > Adicionar à Tela de
  Início**. No Chrome, **⋮ > Adicionar à tela inicial**.
- **Microfone da agenda:** funciona no Chrome, no Edge e no Safari. Na primeira vez, permita o microfone quando o
  navegador pedir.

## Opcional

- **Geração automática de imagens:** troque `IMAGE_PROVIDER` para `openai` e adicione `OPENAI_API_KEY`.
- **Busca de referências por semelhança:** troque `EMBEDDING_PROVIDER` para `voyage` e adicione
  `VOYAGE_API_KEY`. Depois reanalise as referências da biblioteca.

## Se algo der errado

| Sintoma | Causa provável |
|---|---|
| Deploy falha com "unable to verify the first certificate" | `DATABASE_CA_CERT` incompleto ou ausente |
| Deploy falha com "password authentication failed" | senha errada no `DATABASE_URL` |
| "ANTHROPIC_API_KEY é obrigatória" | `AI_PROVIDER` está como `anthropic` sem a chave; apague `AI_PROVIDER` |
| "A IA do aplicativo está desligada" | é o esperado sem chave; cadastre `ANTHROPIC_API_KEY` para ligar |
| Login volta sempre para a tela de entrada | app aberto por `http://`; use o endereço `https://` |
| "Origem da requisição não permitida" | `APP_URL` diferente do endereço usado no navegador |
| Post falha com mensagem de mídia | `APP_URL` ou `APP_SECRET` ausentes |
| Fotos somem depois de um deploy | volume não montado em `/data` |
| Jornal vazio depois de sincronizar | Instagram não conectado no Windsor.ai ou nomes das métricas do Metricool diferentes (`METRICOOL_TIMELINE_METRICS`) |
