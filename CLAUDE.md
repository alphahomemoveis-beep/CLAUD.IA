# Alfa Home: edição de Reels

Este repositório guarda o editor de vídeo e o guia de estilo da Alfa Home Móveis (@alphahome.moveis), marcenaria de móveis planejados de alto padrão. Fale sempre em português com a pessoa usuária.

## Divisão de trabalho

- A Alfa Home grava as falas, filma as cenas e gera as imagens e renders.
- O Claude escreve roteiros e faz a edição completa com `editor/alpha_edit.py`.

## Fluxo para editar um vídeo

1. Rode `bash editor/setup.sh` no início da sessão. Ele é idempotente.
2. Copie o material enviado para `projetos/<nome-do-video>/`. A fala vai como `fala.mp4`, as cenas em `broll/` e os renders em `renders/`.
3. Rode `python3 editor/alpha_edit.py transcrever projetos/<nome>/fala.mp4` e leia a transcrição.
4. Escreva `projetos/<nome>/roteiro.json`. Escolha os títulos grandes, as inserções e os trechos a remover, como erros e repetições.
5. Renderize com `--previa`, gere uma prancha de quadros com ffmpeg e confira: legenda legível, título sem cortar, rosto enquadrado na tela dividida.
6. Renderize a versão final e envie o arquivo de `saida/` para a pessoa usuária.
7. Faça commit só do `roteiro.json`. Os vídeos ficam fora do git.

Os campos do roteiro estão em `editor/README.md`.

## Guia de estilo visual

Tirado dos cinco Reels de referência da marca, analisados quadro a quadro.

- **Formato:** vertical 9:16, 30 a 75 segundos, fala contínua em voz direta para a câmera.
- **Ritmo:** um corte a cada 3 a 5 segundos, com câmera quase parada e movimentos lentos. Nas revelações, cortes de cerca de 1 segundo.
- **Plano:** alterna plano aberto, com a apresentadora sentada ou de corpo inteiro, e plano fechado no rosto.
- **Legenda:** branca, sem serifa, letras apertadas, uma ou duas palavras por vez, no centro da tela.
- **Títulos grandes:** palavra-chave gigante em negrito, com apoio fino e itálico em cima ou embaixo, entrando com desfoque. Exemplos: "iremos avaliar", "5 elementos", "2º ponto", "vive".
- **Tela dividida:** imagem de apoio na metade de cima, apresentadora na de baixo, emendadas por degradê. A legenda fica na emenda.
- **Imagem de apoio:** mostra exatamente o que a fala descreve, como luz acendendo, gaveta abrindo, rodapé ou render 3D.
- **Assinatura:** ícone do Instagram e @ALPHAHOME.MOVEIS pequenos no canto superior direito.
- **Encerramento:** a tela desfoca e escurece, e o ícone colorido do Instagram com o @ aparece no centro.
- **Cores:** luz quente de fita de LED, madeira e tons neutros. Nada de filtro frio.

## Guia de roteiro

Estrutura que se repete nos vídeos de melhor acabamento:

1. **Gancho nos primeiros 3 segundos**, falado junto com o melhor plano. Tipos que a marca já usa:
   - Curiosidade: "Você provavelmente nunca repararia nesse detalhe…"
   - Lista: "5 elementos de marcenaria que não podem faltar na sua casa de alto padrão."
   - Filtro de público: "Se você está procurando móveis de alto padrão, fique até o final."
   - Casa de famoso: "Hoje iremos avaliar os móveis da casa do…"
2. **De três a cinco pontos concretos.** Cada um traz um detalhe técnico e o benefício para o cliente.
3. **Chamada no meio**, antes do último ponto: "E antes do último, se você está gostando, fale com a Alfa Home."
4. **Frase de posicionamento:** "Não é o ambiente que se adapta aos móveis, são os móveis que se adaptam ao cliente."
5. **Chamada final:** "Chama a Alfa Home no Direct e vem orçar com quem entende."

Pronuncie "Alfa Home" com clareza. A transcrição automática confundiu o nome com "Alfa Romeo" nos vídeos de referência.
