# Desfoque de dados de clientes

Desfoca nome, telefone e endereço de clientes em vídeos de folhas de pedido, acompanhando o movimento da câmera.

```bash
pip install -q rapidocr-onnxruntime
mkdir -p trabalho && cp video.mp4 trabalho/orig.mp4
python3 editor/privacidade/ler_texto.py trabalho/orig.mp4 trabalho/ocr.json   # ~3 s por quadro lido
python3 editor/privacidade/desfocar.py trabalho saida/video_desfocado.mp4 15
python3 editor/privacidade/verificar.py saida/video_desfocado.mp4             # deve terminar com 0 vazamentos
```

As palavras sensíveis ficam na lista `CHAVES` de `desfocar.py` e na lista `CH` de `verificar.py`. Troque pelos dados do novo cliente antes de rodar.
