#!/usr/bin/env bash
# Prepara o ambiente do editor Alfa Home (idempotente).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
pip install -q -r "$DIR/requirements.txt" 2>&1 | grep -v -i "warning" || true
if ! command -v ffmpeg >/dev/null; then
  FF=$(python3 -c "import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())")
  ln -sf "$FF" /usr/local/bin/ffmpeg
fi
M="$DIR/modelos"
mkdir -p "$M"
BASE=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models
if [ ! -f "$M/silero_vad.onnx" ]; then
  curl -sSL -o "$M/silero_vad.onnx" "$BASE/silero_vad.onnx"
fi
if [ ! -f "$M/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx" ]; then
  echo "Baixando modelo de transcrição (~490 MB)…"
  curl -sSL "$BASE/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2" | tar xj -C "$M"
fi
echo "Editor pronto."
