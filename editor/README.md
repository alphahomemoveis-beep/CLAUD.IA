# Editor Alfa Home

Edita Reels verticais (1080x1920, 30 fps) no padrão visual da Alfa Home a partir de um arquivo `roteiro.json`.

## Instalação

```bash
bash editor/setup.sh
```

Instala as bibliotecas Python e baixa o modelo de transcrição (cerca de 490 MB) e o detector de voz.

## Comandos

```bash
# Transcreve a fala e mostra o texto com os tempos (ajuda a escolher títulos e inserções)
python3 editor/alpha_edit.py transcrever projetos/<nome>/fala.mp4

# Prévia rápida em 540x960
python3 editor/alpha_edit.py render projetos/<nome>/roteiro.json --previa

# Versão final em 1080x1920
python3 editor/alpha_edit.py render projetos/<nome>/roteiro.json
```

O vídeo sai em `saida/<nome>.mp4`.

## O que o editor faz sozinho

- Corta pausas e respiros da fala.
- Alterna plano aberto e fechado, com zoom no rosto, a cada corte.
- Legenda palavra a palavra, em blocos de até duas palavras, sincronizada com a fala.
- Títulos grandes com entrada em desfoque nas frases escolhidas.
- Tela dividida com degradê: imagem de apoio em cima e apresentadora embaixo.
- Assinatura @alphahome.moveis no canto superior direito, colorida no primeiro segundo.
- Encerramento com a tela desfocada e escurecida e o @ no centro.
- Música de fundo que abaixa sozinha quando há fala, com volume final normalizado para Instagram.

## Campos do roteiro.json

| Campo | Para que serve |
|---|---|
| `nome` | Nome do arquivo de saída. |
| `fala` | Vídeo com a apresentadora falando. É a base do vídeo. |
| `sequencia` | Sem fala: lista de cenas `{arquivo, inicio, fim, movimento}`. `movimento` é `entrar`, `sair` ou `nenhum`. |
| `musica` | Arquivo de música (mp3, m4a, wav ou vídeo). |
| `musica_inicio` | Segundo da música onde começar. |
| `volume_musica` | Volume sob a fala. O padrão é 0.16. |
| `volume_musica_sem_fala` | Volume quando ninguém fala. O padrão é 0.32. |
| `som_das_cenas` | `true` para manter o som original das cenas no modo sem fala. |
| `cortar_pausas` | `false` para manter a fala sem cortes. O padrão é `true`. |
| `pausa_maxima` | Menor pausa que é cortada, em segundos. O padrão é 0.30. |
| `remover` | Trechos da fala original a tirar, como `[[12.4, 14.1]]`. Serve para erros e repetições. |
| `zoom_alternado` | `false` para desligar o zoom de corte. |
| `titulos` | Frases da fala que viram título grande. `{frase, destaque, ocorrencia}`. `destaque` é a palavra gigante. |
| `insercoes` | Imagens de apoio. `{arquivo, na_palavra ou inicio, duracao ou fim, modo, inicio_arquivo, movimento}`. `modo` é `dividida` ou `cheia`. |
| `textos` | Textos manuais `{texto, inicio, fim, destaque}`. Com `destaque`, vira título grande. |
| `encerramento` | `false` para tirar o cartão final. |
| `fontes` | Fonte de cada papel: `legenda`, `titulo`, `apoio` e `marca`. Aceita o caminho do arquivo ou `{arquivo, peso}`. O peso só vale para fontes variáveis. |

## Fontes da marca

Para usar as mesmas fontes em todos os vídeos, coloque os arquivos `.ttf` ou `.otf` em `editor/assets/fonts/marca/` e crie ali um `fontes.json`:

```json
{
  "legenda": "MinhaFonte-SemiBold.ttf",
  "titulo": "MinhaFonte-Black.ttf",
  "apoio": "MinhaFonte-LightItalic.ttf",
  "marca": "MinhaFonte-Medium.ttf"
}
```

O campo `fontes` de um roteiro tem prioridade sobre esse arquivo.

Os tempos de `insercoes` e `textos` são do vídeo já editado. `na_palavra` encontra o momento sozinho, o que evita recalcular quando as pausas mudam.

Imagens (jpg, png, webp) funcionam como inserção ou cena e ganham zoom lento automático.

Exemplos prontos estão em `projetos/exemplos/`.
