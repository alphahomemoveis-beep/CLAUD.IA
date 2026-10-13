import { z } from "zod";
import { FORMATS, FORMAT_INFO, type Format } from "./formats";

export { FORMATS, FORMAT_INFO, type Format };

export const PecaSchema = z.object({
  titulo: z.string().min(1).max(60).describe("Palavra-chave gigante na tela, de 1 a 4 palavras, em minúsculas (ex.: '5 elementos', '2º ponto', 'vive')"),
  apoio: z.string().max(90).describe("Frase curta, fina e em itálico, que acompanha o título. Pode ficar vazia"),
  texto: z.string().max(260).describe("Texto de apoio da arte (carrossel, feed, story). Vazio nas cenas de vídeo sem texto extra"),
  fala: z.string().max(400).describe("O que a apresentadora fala nesta cena, em voz direta para a câmera. Vazio nas artes estáticas"),
  imagem: z.string().max(200).describe("O que a imagem de fundo deve mostrar, em português, exatamente o que a fala ou o texto descreve"),
  busca_imagem: z.string().max(60).describe("De 2 a 5 palavras em inglês para buscar essa foto num banco de imagens (ex.: 'walnut kitchen led strip')"),
  duracao_s: z.number().min(0).max(12).describe("Duração da cena em segundos (de 2 a 6 em Reels e roteiro); 0 nas artes estáticas"),
});
export type Peca = z.infer<typeof PecaSchema>;

export const OpcaoSchema = z.object({
  titulo: z.string().min(1).max(90).describe("Nome curto da ideia"),
  formato_viral: z.string().max(80).describe("O molde que está funcionando: lista, antes e depois, casa de famoso, erro comum, detalhe escondido..."),
  gancho: z.string().max(220).describe("A frase dos primeiros 3 segundos (ou a capa do carrossel)"),
  por_que_funciona: z.string().max(500).describe("Por que esta opção tende a viralizar, ligando à tendência pesquisada e ao público da marca"),
  tendencia_base: z.string().max(240).describe("Qual tendência da pesquisa esta opção aproveita"),
  pecas: z.array(PecaSchema).min(1).max(10).describe("Cenas (Reels, roteiro) ou páginas (carrossel, story, feed), na ordem"),
  legenda: z.string().max(1800).describe("Legenda pronta para o post, com chamada para o Direct"),
  hashtags: z.array(z.string().max(40)).max(12).describe("De 5 a 10 hashtags, com #"),
  audio_sugerido: z.string().max(160).describe("Tipo de áudio em alta para escolher no Instagram, ou vazio para artes"),
});
export type Opcao = z.infer<typeof OpcaoSchema>;

export const OpcoesSchema = z.object({
  tendencias: z.array(z.object({
    tendencia: z.string().max(200),
    evidencia: z.string().max(400).describe("O que foi observado e onde"),
    fonte_url: z.string().max(400).describe("Link da fonte da pesquisa, ou vazio"),
  })).max(8).describe("O que está em alta agora, com a evidência"),
  opcoes: z.array(OpcaoSchema).length(3).describe("Exatamente 3 opções bem diferentes entre si"),
});
export type Opcoes = z.infer<typeof OpcoesSchema>;
