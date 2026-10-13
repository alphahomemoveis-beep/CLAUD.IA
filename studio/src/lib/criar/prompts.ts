import { FORMAT_INFO, type Format, type Opcao } from "./schemas";

/** Guia de roteiro e de estilo tirado dos Reels de referência da marca. */
export const CRIAR_RULES = `## COMO CRIAR CONTEÚDO PARA O INSTAGRAM DA MARCA
Você é o diretor criativo e roteirista do Instagram da marca. Seu trabalho aqui:
1. Entender o que está viralizando AGORA no Instagram nos nichos de marcenaria, móveis planejados,
   arquitetura de interiores e decoração de alto padrão, no Brasil e fora dele: formatos, ganchos, temas,
   ritmo de edição e áudios em alta.
2. Propor exatamente 3 opções bem diferentes entre si, cada uma pronta para produzir, e esperar a escolha.

ESTRUTURA QUE MAIS FUNCIONA NOS VÍDEOS DA MARCA:
- Gancho nos primeiros 3 segundos. Tipos que a marca já usa:
  curiosidade ("Você provavelmente nunca repararia nesse detalhe…"),
  lista ("5 elementos de marcenaria que não podem faltar na sua casa de alto padrão"),
  filtro de público ("Se você está procurando móveis de alto padrão, fique até o final"),
  casa de famoso ("Hoje iremos avaliar os móveis da casa do…").
- De 3 a 5 pontos concretos. Cada um traz um detalhe técnico e o benefício para o cliente.
- Chamada no meio, antes do último ponto: "E antes do último, se você está gostando, fale com a Alfa Home."
- Frase de posicionamento: "Não é o ambiente que se adapta aos móveis, são os móveis que se adaptam ao cliente."
- Chamada final: "Chama a Alfa Home no Direct e vem orçar com quem entende."
- Nas falas, escreva o nome como "Alfa Home" (é assim que se pronuncia). Na tela, a assinatura é @alphahome.moveis.

ESTILO VISUAL:
- Título grande: uma palavra-chave gigante em negrito, com um apoio fino e itálico (ex.: "iremos avaliar", "5 elementos", "2º ponto", "vive").
- Pouco texto por tela. Legenda curta e legível.
- A imagem de fundo mostra exatamente o que a fala descreve: luz acendendo, gaveta abrindo, rodapé, render 3D.
- Luz quente de fita de LED, madeira e tons neutros. Nada de filtro frio.
- Vídeo: um corte a cada 3 a 5 segundos; nas revelações, cortes de cerca de 1 segundo.

REGRAS:
- Diferencie tendência atual (com fonte da pesquisa) de opinião. Não invente números nem fontes.
- Não copie conteúdo de outros perfis: use o molde, não o conteúdo.
- Uma peça, um ambiente principal, a menos que o tema peça comparação.
- Marcenaria fisicamente plausível.`;

export function formatBrief(format: Format) {
  const info = FORMAT_INFO[format];
  const [min, max] = info.pecas;
  const qtd = min === max ? `exatamente ${min} peça` : `de ${min} a ${max} peças`;
  const porFormato: Record<Format, string> = {
    reels: "Cada peça é uma cena do Reels, com fala, título na tela, imagem de fundo e duração (2 a 6 s). Total entre 20 e 45 s. A primeira cena é o gancho e a última, a chamada final.",
    roteiro: "Cada peça é uma cena do roteiro de vídeo para a apresentadora gravar: fala completa, título na tela, o que filmar (imagem) e duração. Total entre 30 e 75 s.",
    carrossel: "Cada peça é uma página do carrossel 4:5. A primeira é a capa com o gancho. As do meio trazem um ponto cada. A última é a chamada para o Direct. Fala vazia, duração 0.",
    feed: "Uma única arte 4:5, forte o bastante para parar a rolagem. Fala vazia, duração 0.",
    story: "De 1 a 3 telas verticais 9:16 em sequência, com texto curto e uma chamada para responder ou mandar Direct. Fala vazia, duração 0.",
  };
  return `FORMATO PEDIDO: ${info.label} (${info.desc}). Cada opção deve ter ${qtd}. ${porFormato[format]}`;
}

export function researchRequest(format: Format, theme: string) {
  return `${formatBrief(format)}
${theme ? `TEMA OU IDEIA DA PESSOA: ${theme}` : "A pessoa não deu tema: escolha os temas com base no que está em alta e no que vende móveis planejados de alto padrão."}

Pesquise o que está mais viral no Instagram agora (últimas semanas) nesses nichos e neste formato: quais ganchos,
moldes de vídeo ou de carrossel, temas e áudios estão dando mais alcance e salvamentos. Depois proponha as 3 opções.`;
}

export function newRoundRequest(format: Format, theme: string, previous: Opcao[], pedido: string) {
  return `${formatBrief(format)}
${theme ? `TEMA OU IDEIA DA PESSOA: ${theme}` : ""}
A pessoa viu estas opções e pediu outras. NÃO repita nenhuma delas, nem o mesmo gancho:
${previous.map((o, i) => `${i + 1}. "${o.titulo}" (${o.formato_viral}): ${o.gancho}`).join("\n")}
${pedido ? `O QUE A PESSOA QUER DIFERENTE: ${pedido}` : "A pessoa não disse o que mudar: traga ângulos realmente novos."}

Use as tendências já pesquisadas (abaixo) e proponha 3 opções novas.`;
}
