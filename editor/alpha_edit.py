#!/usr/bin/env python3
"""Editor automático de Reels no padrão Alfa Home.

Uso:
  python3 editor/alpha_edit.py transcrever projetos/<nome>/fala.mp4
  python3 editor/alpha_edit.py render projetos/<nome>/roteiro.json [--previa]

O roteiro.json descreve o vídeo. Veja editor/README.md para todos os campos.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
FONTE = os.path.join(AQUI, "assets", "fonts", "InterTight[wght].ttf")
FONTE_IT = os.path.join(AQUI, "assets", "fonts", "InterTight-Italic[wght].ttf")
MODELOS = os.environ.get("ALPHA_MODELOS", os.path.join(AQUI, "modelos"))
ASR_DIR = os.path.join(MODELOS, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8")
VAD_ONNX = os.path.join(MODELOS, "silero_vad.onnx")

FPS = 30
SR = 48000


def ffmpeg_bin():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


FF = ffmpeg_bin()


# ---------------------------------------------------------------- estilo ----
class Estilo:
    """Medidas pensadas para 1080x1920 e escaladas para a prévia."""

    def __init__(self, largura):
        self.W = largura
        self.H = largura * 16 // 9
        k = largura / 1080
        self.k = k
        self.legenda_tam = round(56 * k)
        self.legenda_peso = 620
        self.legenda_track = -2.2 * k
        self.legenda_y = 0.50
        self.titulo_tam = round(210 * k)
        self.titulo_peso = 800
        self.titulo_track = -11 * k
        self.titulo_max_larg = 0.90 * largura
        self.apoio_tam = round(62 * k)
        self.apoio_peso = 430
        self.apoio_track = -1.5 * k
        self.handle = "@ALPHAHOME.MOVEIS"
        self.marca_y = 0.245
        self.zoom_fechado = 1.18
        self.divisao_topo = 0.47   # b-roll opaco até aqui
        self.divisao_fim = 0.58    # degradê termina aqui
        self.rosto_dividida = 0.70  # altura do rosto na tela dividida


_fontes = {}

# Fonte de cada papel no vídeo: arquivo e peso (o peso só vale para fontes variáveis).
# Pode ser trocada pelo campo "fontes" do roteiro ou por editor/assets/fonts/marca/fontes.json.
FONTES = {
    "legenda": {"arquivo": FONTE, "peso": None},
    "titulo": {"arquivo": FONTE, "peso": None},
    "apoio": {"arquivo": FONTE_IT, "peso": None},
    "marca": {"arquivo": FONTE, "peso": 560},
}
PESOS_PADRAO = {"legenda": 620, "titulo": 800, "apoio": 430, "marca": 560}


def configura_fontes(cfg_fontes, pasta):
    """Aplica fontes da marca (arquivo global) e depois as do roteiro."""
    marca = os.path.join(AQUI, "assets", "fonts", "marca", "fontes.json")
    for origem, base in ((marca, os.path.dirname(marca)), (None, pasta)):
        dados = cfg_fontes if origem is None else (json.load(open(origem)) if os.path.exists(origem) else {})
        for papel, v in (dados or {}).items():
            if papel not in FONTES:
                print(f"  aviso: papel de fonte desconhecido {papel!r}", file=sys.stderr)
                continue
            if isinstance(v, str):
                v = {"arquivo": v}
            arq = v["arquivo"] if os.path.isabs(v["arquivo"]) else os.path.join(base, v["arquivo"])
            if not os.path.exists(arq):
                raise SystemExit(f"fonte não encontrada: {arq}")
            FONTES[papel] = {"arquivo": arq, "peso": v.get("peso"), "largura": v.get("largura"),
                             "maiusculas": bool(v.get("maiusculas")), "escala": float(v.get("escala", 1.0)),
                             "espacamento": v.get("espacamento")}
    _fontes.clear()


def caixa(txt, papel):
    return txt.upper() if FONTES[papel].get("maiusculas") else txt


def escala(papel):
    return FONTES[papel].get("escala", 1.0)


def espacamento(papel, padrao):
    v = FONTES[papel].get("espacamento")
    return padrao if v is None else v


def fonte(tam, peso=None, italico=False, papel=None):
    if papel is None:
        papel = "apoio" if italico else "legenda"
    info = FONTES[papel]
    peso = info.get("peso") or peso or PESOS_PADRAO[papel]
    chave = (papel, tam, peso)
    if chave not in _fontes:
        f = ImageFont.truetype(info["arquivo"], tam)
        try:
            eixos = f.get_variation_axes()
            valores = []
            for e in eixos:
                nome = e["name"].decode() if isinstance(e["name"], bytes) else str(e["name"])
                if nome.lower().startswith(("weight", "wght")):
                    valores.append(min(max(peso, e["minimum"]), e["maximum"]))
                elif nome.lower().startswith(("width", "wdth")) and info.get("largura"):
                    valores.append(min(max(info["largura"], e["minimum"]), e["maximum"]))
                else:
                    valores.append(e["default"])
            f.set_variation_by_axes(valores)
        except Exception:
            pass  # fonte estática: o peso vem do próprio arquivo
        _fontes[chave] = f
    return _fontes[chave]


def largura_texto(txt, f, track):
    if not txt:
        return 0
    return sum(f.getlength(c) for c in txt) + track * (len(txt) - 1)


def desenha_texto(txt, f, track, sombra=0.35, cor=(255, 255, 255)):
    """Texto com espaçamento apertado e sombra suave. Retorna RGBA."""
    asc, desc = f.getmetrics()
    larg = int(largura_texto(txt, f, track)) + 8
    alt = asc + desc
    pad = max(12, alt // 5)
    img = Image.new("L", (larg + 2 * pad, alt + 2 * pad), 0)
    d = ImageDraw.Draw(img)
    x = pad
    for c in txt:
        d.text((x, pad), c, font=f, fill=255)
        x += f.getlength(c) + track
    rgba = Image.new("RGBA", img.size, cor + (0,))
    rgba.putalpha(img)
    if sombra:
        s = img.filter(ImageFilter.GaussianBlur(pad / 2.5)).point(lambda v: int(v * sombra))
        base = Image.new("RGBA", img.size, (0, 0, 0, 0))
        base.putalpha(s)
        base = base.transform(img.size, Image.AFFINE, (1, 0, 0, 0, 1, -pad // 4))
        base.alpha_composite(rgba)
        rgba = base
    return rgba


def icone_instagram(tam, colorido):
    esc = 4
    t = tam * esc
    m = Image.new("L", (t, t), 0)
    d = ImageDraw.Draw(m)
    e = max(2, round(t * 0.085))
    d.rounded_rectangle([e / 2, e / 2, t - e / 2, t - e / 2], radius=t * 0.28, outline=255, width=e)
    r = t * 0.22
    d.ellipse([t / 2 - r, t / 2 - r, t / 2 + r, t / 2 + r], outline=255, width=e)
    p = t * 0.055
    d.ellipse([t * 0.76 - p, t * 0.24 - p, t * 0.76 + p, t * 0.24 + p], fill=255)
    m = m.resize((tam, tam), Image.LANCZOS)
    if colorido:
        yy, xx = np.mgrid[0:tam, 0:tam] / max(1, tam - 1)
        u = np.clip((xx * 0.4 + (1 - yy) * 0.6), 0, 1)[..., None]
        c1 = np.array([253, 200, 90])   # amarelo
        c2 = np.array([225, 48, 108])   # rosa
        c3 = np.array([131, 58, 180])   # roxo
        cor = np.where(u < 0.5, c1 + (c2 - c1) * (u / 0.5), c2 + (c3 - c2) * ((u - 0.5) / 0.5))
        cor = cor[::-1]
        img = Image.fromarray(cor.astype(np.uint8), "RGB").convert("RGBA")
    else:
        img = Image.new("RGBA", (tam, tam), (255, 255, 255, 255))
    img.putalpha(m)
    return img


def marca_dagua(est, colorido):
    ic = icone_instagram(round(34 * est.k), colorido)
    tx = desenha_texto(est.handle, fonte(round(17 * est.k), 560, papel="marca"), 0.2, sombra=0.3)
    larg = max(ic.width, tx.width)
    img = Image.new("RGBA", (larg, ic.height + tx.height), (0, 0, 0, 0))
    img.alpha_composite(ic, (larg - ic.width - round(10 * est.k), 0))
    img.alpha_composite(tx, (larg - tx.width, ic.height - round(6 * est.k)))
    return np.array(img)


def cartao_final(est):
    ic = icone_instagram(round(118 * est.k), True)
    tx = desenha_texto(est.handle, fonte(round(30 * est.k), 560, papel="marca"), 0.4, sombra=0.4)
    larg = max(ic.width, tx.width)
    img = Image.new("RGBA", (larg, ic.height + tx.height + round(8 * est.k)), (0, 0, 0, 0))
    img.alpha_composite(ic, ((larg - ic.width) // 2, 0))
    img.alpha_composite(tx, ((larg - tx.width) // 2, ic.height + round(8 * est.k)))
    return np.array(img)


def bloco_titulo(est, antes, destaque, depois):
    """Título grande: apoio fino em cima, palavra gigante, apoio embaixo."""
    destaque = caixa(destaque, "titulo")
    antes, depois = caixa(antes, "apoio"), caixa(depois, "apoio")
    tam0 = round(est.titulo_tam * escala("titulo"))
    trk0 = espacamento("titulo", est.titulo_track / est.k) * est.k
    tam = tam0
    ft = fonte(tam, est.titulo_peso, papel="titulo")
    while largura_texto(destaque, ft, trk0 * tam / tam0) > est.titulo_max_larg and tam > 60:
        tam = int(tam * 0.93)
        ft = fonte(tam, est.titulo_peso, papel="titulo")
    grande = desenha_texto(destaque, ft, trk0 * tam / tam0, sombra=0.42)
    fa = fonte(round(est.apoio_tam * escala("apoio")), est.apoio_peso, papel="apoio")
    partes = []
    if antes:
        partes.append(("a", desenha_texto(antes, fa, est.apoio_track, sombra=0.6)))
    partes.append(("g", grande))
    if depois:
        partes.append(("a", desenha_texto(depois, fa, est.apoio_track, sombra=0.6)))
    sobrepoe = int(tam * 0.30)
    alt = 0
    ys = []
    for i, (tipo, im) in enumerate(partes):
        if i > 0:
            alt -= sobrepoe if (tipo == "g" or partes[i - 1][0] == "g") else int(est.apoio_tam * 0.3)
        ys.append(alt)
        alt += im.height
    larg = max(im.width for _, im in partes)
    canv = Image.new("RGBA", (larg, alt), (0, 0, 0, 0))
    for (tipo, im), y in zip(partes, ys):
        canv.alpha_composite(im, ((larg - im.width) // 2, y))
    return canv


def cola(frame, rgba, cx, cy, alpha=1.0):
    """Cola RGBA (numpy) centrado em (cx, cy) no frame RGB uint8."""
    h, w = rgba.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    colar_em(frame, rgba, x0, y0, alpha)


def colar_em(frame, rgba, x0, y0, alpha=1.0):
    H, W = frame.shape[:2]
    h, w = rgba.shape[:2]
    xa, ya = max(0, x0), max(0, y0)
    xb, yb = min(W, x0 + w), min(H, y0 + h)
    if xa >= xb or ya >= yb:
        return
    src = rgba[ya - y0:yb - y0, xa - x0:xb - x0]
    a = src[..., 3:4].astype(np.float32) / 255.0 * alpha
    dst = frame[ya:yb, xa:xb].astype(np.float32)
    frame[ya:yb, xa:xb] = (dst * (1 - a) + src[..., :3].astype(np.float32) * a).astype(np.uint8)


# ------------------------------------------------------------ utilidades ----
def normaliza(p):
    p = unicodedata.normalize("NFD", p.lower())
    p = "".join(c for c in p if unicodedata.category(c) != "Mn")
    return re.sub(r"[^\w]", "", p)


def duracao(arquivo):
    out = subprocess.run([FF, "-i", arquivo], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    if not m:
        return 0.0
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def tem_audio(arquivo):
    out = subprocess.run([FF, "-i", arquivo], capture_output=True, text=True).stderr
    return "Audio:" in out


def le_audio(arquivo, sr=SR, canais=2, inicio=None, dur=None):
    cmd = [FF, "-v", "error"]
    if inicio is not None:
        cmd += ["-ss", f"{inicio:.3f}"]
    cmd += ["-i", arquivo]
    if dur is not None:
        cmd += ["-t", f"{dur:.3f}"]
    cmd += ["-vn", "-ac", str(canais), "-ar", str(sr), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    a = np.frombuffer(raw, dtype=np.float32)
    return a.reshape(-1, canais) if canais > 1 else a


# ----------------------------------------------------------- transcrição ----
def segmentos_de_voz(a16, min_silencio=0.28, max_fala=14):
    import sherpa_onnx
    cfg = sherpa_onnx.VadModelConfig()
    cfg.silero_vad.model = VAD_ONNX
    cfg.silero_vad.min_silence_duration = min_silencio
    cfg.silero_vad.min_speech_duration = 0.15
    cfg.silero_vad.max_speech_duration = max_fala
    cfg.silero_vad.threshold = 0.45
    cfg.sample_rate = 16000
    vad = sherpa_onnx.VoiceActivityDetector(cfg, buffer_size_in_seconds=600)
    ws = cfg.silero_vad.window_size
    segs = []

    def coleta():
        while not vad.empty():
            s = vad.front.start
            segs.append((s / 16000, (s + len(vad.front.samples)) / 16000))
            vad.pop()

    for k in range(0, len(a16), ws):
        bloco = a16[k:k + ws]
        if len(bloco) < ws:
            bloco = np.pad(bloco, (0, ws - len(bloco)))
        vad.accept_waveform(bloco)
        coleta()
    vad.flush()
    coleta()
    return segs


def divide_longos(segs, a16, limite=18.0):
    """Quebra trechos de fala longos no ponto mais silencioso (o reconhecedor prefere trechos curtos)."""
    out = []
    for s0, s1 in segs:
        while s1 - s0 > limite:
            j0, j1 = int((s0 + 10) * 16000), int((s0 + 16) * 16000)
            bloco = a16[j0:j1]
            n = 160
            rms = np.sqrt(np.convolve(bloco ** 2, np.ones(n) / n, mode="valid"))
            corte = s0 + 10 + int(np.argmin(rms)) / 16000
            out.append((s0, corte))
            s0 = corte
        out.append((s0, s1))
    return out


def transcrever(arquivo, cache=True):
    destino = os.path.splitext(arquivo)[0] + ".transcricao.json"
    if cache and os.path.exists(destino) and os.path.getmtime(destino) > os.path.getmtime(arquivo):
        return json.load(open(destino))
    import sherpa_onnx
    a16 = le_audio(arquivo, sr=16000, canais=1)
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=os.path.join(ASR_DIR, "encoder.int8.onnx"),
        decoder=os.path.join(ASR_DIR, "decoder.int8.onnx"),
        joiner=os.path.join(ASR_DIR, "joiner.int8.onnx"),
        tokens=os.path.join(ASR_DIR, "tokens.txt"),
        model_type="nemo_transducer", num_threads=os.cpu_count() or 4)
    segs = divide_longos(segmentos_de_voz(a16), a16)
    palavras = []
    for s0, s1 in segs:
        st = rec.create_stream()
        st.accept_waveform(16000, a16[int(s0 * 16000):int(s1 * 16000)])
        rec.decode_stream(st)
        r = st.result
        atual = None
        for tok, ts in zip(r.tokens, r.timestamps):
            t = s0 + ts
            if atual is None or tok.startswith(" ") and tok.strip():
                if atual:
                    palavras.append(atual)
                atual = {"p": tok.strip(), "s": round(t, 3), "u": round(t, 3)}
            else:
                atual["p"] += tok
                atual["u"] = round(t, 3)
        if atual:
            palavras.append(atual)
        # fim de cada palavra: início da próxima ou último token + margem
        for i in range(len(palavras) - 1, -1, -1):
            w = palavras[i]
            if "e" in w:
                break
            prox = palavras[i + 1]["s"] if i + 1 < len(palavras) and "e" in palavras[i + 1] else s1
            w["e"] = round(min(prox, w["u"] + 0.32, s1 + 0.05), 3)
    for w in palavras:
        w.pop("u", None)
    dados = {"arquivo": os.path.basename(arquivo), "duracao": len(a16) / 16000,
             "voz": [[round(a, 3), round(b, 3)] for a, b in segs], "palavras": palavras}
    json.dump(dados, open(destino, "w"), ensure_ascii=False, indent=1)
    return dados


# -------------------------------------------------------------- leitores ----
class LeitorVideo:
    """Lê quadros em sequência, já no tamanho de saída (preenchendo a tela)."""

    def __init__(self, arquivo, W, H, inicio=0.0):
        self.W, self.H = W, H
        self.idx = -1
        self.ultimo = None
        self.inicio = inicio
        vf = f"fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase:flags=bicubic,crop={W}:{H},setsar=1"
        self.p = subprocess.Popen(
            [FF, "-v", "error", "-ss", f"{inicio:.3f}", "-i", arquivo, "-an", "-vf", vf,
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def quadro(self, i):
        """Quadro número i contado a partir do início pedido (só avança)."""
        n = self.W * self.H * 3
        while self.idx < i:
            raw = self.p.stdout.read(n)
            if len(raw) < n:
                break
            self.ultimo = np.frombuffer(raw, np.uint8).reshape(self.H, self.W, 3)
            self.idx += 1
        if self.ultimo is None:
            return np.zeros((self.H, self.W, 3), np.uint8)
        return self.ultimo

    def fecha(self):
        try:
            self.p.stdout.close()
            self.p.kill()
        except Exception:
            pass


class Midia:
    """Vídeo ou imagem usado como cena ou inserção, com zoom lento opcional."""

    EXT_IMG = (".jpg", ".jpeg", ".png", ".webp")

    def __init__(self, arquivo, W, H, inicio=0.0, dur=3.0, movimento="entrar"):
        self.W, self.H, self.dur, self.mov = W, H, max(dur, 1 / FPS), movimento
        self.img = None
        self.leitor = None
        if arquivo.lower().endswith(self.EXT_IMG):
            im = Image.open(arquivo).convert("RGB")
            esc = max(W * 1.12 / im.width, H * 1.12 / im.height)
            im = im.resize((int(im.width * esc + 0.5), int(im.height * esc + 0.5)), Image.LANCZOS)
            self.img = np.array(im)
        else:
            self.leitor = LeitorVideo(arquivo, W, H, inicio)

    def quadro(self, t):
        p = min(1.0, max(0.0, t / self.dur))
        if self.mov == "entrar":
            z = 1.0 + 0.07 * p
        elif self.mov == "sair":
            z = 1.07 - 0.07 * p
        else:
            z = 1.0
        if self.img is not None:
            h, w = self.img.shape[:2]
            cw, ch = min(w, int(self.W * 1.12 / z)), min(h, int(self.H * 1.12 / z))
            x0, y0 = (w - cw) // 2, (h - ch) // 2
            return cv2.resize(self.img[y0:y0 + ch, x0:x0 + cw], (self.W, self.H), interpolation=cv2.INTER_AREA)
        f = self.leitor.quadro(int(round(t * FPS)))
        return aplica_zoom(f, z, 0.5, 0.5) if z != 1.0 else f

    def fecha(self):
        if self.leitor:
            self.leitor.fecha()


def aplica_zoom(f, z, cx, cy, com_posicao=False):
    """Zoom centrado no ponto (cx, cy) relativo; opcionalmente devolve onde o ponto foi parar."""
    H, W = f.shape[:2]
    cw, ch = W / z, H / z
    x0 = min(max(cx * W - cw / 2, 0), W - cw)
    y0 = min(max(cy * H - ch / 2, 0), H - ch)
    pos = ((cx * W - x0) * z / W, (cy * H - y0) * z / H)
    if abs(z - 1.0) < 1e-3:
        out = f
    else:
        M = np.array([[z, 0, -x0 * z], [0, z, -y0 * z]], dtype=np.float32)
        out = cv2.warpAffine(f, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return (out, pos) if com_posicao else out


def centro_do_rosto(arquivo, dur):
    cas = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    cap = cv2.VideoCapture(arquivo)
    pts = []
    for t in np.linspace(0.5, max(0.6, dur - 0.5), 12):
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, fr = cap.read()
        if not ok:
            continue
        g = cv2.cvtColor(cv2.resize(fr, (fr.shape[1] // 3, fr.shape[0] // 3)), cv2.COLOR_BGR2GRAY)
        rs = cas.detectMultiScale(g, 1.1, 5, minSize=(30, 30))
        if len(rs):
            x, y, w, h = max(rs, key=lambda r: r[2] * r[3])
            pts.append(((x + w / 2) / g.shape[1], (y + h / 2) / g.shape[0]))
    cap.release()
    if not pts:
        return 0.5, 0.33
    a = np.median(np.array(pts), axis=0)
    return float(a[0]), float(a[1])


# ------------------------------------------------------------- linha do tempo
def trechos_da_fala(transc, cfg, dur_fonte):
    """Intervalos da fala original que ficam no vídeo (sem pausas e sem remoções)."""
    pausa = cfg.get("pausa_maxima", 0.30)
    antes, depois = 0.10, 0.16
    if cfg.get("cortar_pausas", True):
        base = [[max(0, a - antes), min(dur_fonte, b + depois)] for a, b in transc["voz"]]
    else:
        base = [[0, dur_fonte]]
    remover = list(cfg.get("remover", []))
    if cfg.get("cortar_pausas", True):
        ws = transc["palavras"]
        lim = cfg.get("pausa_entre_palavras", 0.55)
        for w, prox in zip(ws, ws[1:]):
            if prox["s"] - w["e"] > lim:
                remover.append([w["e"] + 0.12, prox["s"] - 0.08])
    for a, b in remover:
        novo = []
        for x, y in base:
            if b <= x or a >= y:
                novo.append([x, y])
                continue
            if a > x:
                novo.append([x, a])
            if b < y:
                novo.append([b, y])
        base = novo
    base.sort()
    junto = []
    for a, b in base:
        if junto and a - junto[-1][1] < pausa:
            junto[-1][1] = max(junto[-1][1], b)
        else:
            junto.append([a, b])
    return [[a, b] for a, b in junto if b - a > 0.12]


def mapeia(trechos, t):
    """Tempo da fala original para o tempo do vídeo editado (None se cortado)."""
    acc = 0.0
    for a, b in trechos:
        if a <= t <= b:
            return acc + t - a
        if t < a:
            return acc
        acc += b - a
    return acc


def grupos_de_legenda(palavras, max_pal=2, max_car=16):
    grupos, atual = [], []
    for w in palavras:
        atual.append(w)
        txt = " ".join(x["p"] for x in atual)
        fim_frase = re.search(r"[.,!?;:]$", w["p"])
        if len(atual) >= max_pal or len(txt) >= max_car or fim_frase:
            grupos.append(atual)
            atual = []
    if atual:
        grupos.append(atual)
    return grupos


def limpa(txt):
    return re.sub(r"[.,;:]+(?=\s|$)", "", txt).strip()


def eventos_de_texto(palavras, titulos, dur_total):
    """Converte palavras (já no tempo editado) em legendas e títulos grandes."""
    norm = [normaliza(w["p"]) for w in palavras]
    marcados = {}
    for tdef in titulos:
        if isinstance(tdef, str):
            tdef = {"frase": tdef}
        alvo = [normaliza(x) for x in tdef["frase"].split() if normaliza(x)]
        n = len(alvo)
        ocorr = tdef.get("ocorrencia", 1)
        vistas = 0
        for i in range(len(norm) - n + 1):
            if norm[i:i + n] == alvo and not any(j in marcados for j in range(i, i + n)):
                vistas += 1
                if vistas == ocorr:
                    for j in range(i, i + n):
                        marcados[j] = (i, tdef)
                    break
        else:
            print(f"  aviso: título não encontrado na fala: {tdef['frase']!r}", file=sys.stderr)
    eventos = []
    i = 0
    comuns = []
    while i < len(palavras):
        if i in marcados:
            ini, tdef = marcados[i]
            j = i
            while j + 1 < len(palavras) and marcados.get(j + 1, (None,))[0] == ini:
                j += 1
            ws = [palavras[k]["p"] for k in range(i, j + 1)]
            dest = tdef.get("destaque")
            if dest is None:
                dest = max(ws, key=lambda x: len(normaliza(x)))
            dn = [normaliza(x) for x in dest.split()]
            wn = [normaliza(x) for x in ws]
            pos = next((k for k in range(len(wn)) if wn[k:k + len(dn)] == dn), len(wn) - 1)
            eventos.append({"tipo": "titulo", "s": palavras[i]["s"], "e": palavras[j]["e"] + 0.45,
                            "antes": limpa(" ".join(ws[:pos])),
                            "destaque": limpa(" ".join(ws[pos:pos + len(dn)])),
                            "depois": limpa(" ".join(ws[pos + len(dn):]))})
            i = j + 1
        else:
            j = i
            bloco = []
            while j < len(palavras) and j not in marcados:
                bloco.append(palavras[j])
                j += 1
            for g in grupos_de_legenda(bloco):
                eventos.append({"tipo": "legenda", "s": g[0]["s"], "e": g[-1]["e"] + 0.25,
                                "texto": limpa(" ".join(w["p"] for w in g))})
            i = j
    eventos.sort(key=lambda e: e["s"])
    for a, b in zip(eventos, eventos[1:]):
        if b["s"] - a["e"] < 0.6:
            a["e"] = b["s"]
        else:
            a["e"] = min(a["e"], b["s"])
    if eventos:
        eventos[-1]["e"] = min(eventos[-1]["e"] + 0.3, dur_total)
    return eventos


# ------------------------------------------------------------------ render --
class Textos:
    def __init__(self, est, eventos):
        self.est = est
        self.ev = eventos
        self.cache = {}

    def imagem(self, i):
        if i not in self.cache:
            e = self.ev[i]
            if e["tipo"] == "titulo":
                im = bloco_titulo(self.est, e.get("antes", ""), e["destaque"], e.get("depois", ""))
            else:
                est = self.est
                txt = caixa(e["texto"], "legenda")
                tam = round(est.legenda_tam * escala("legenda"))
                trk = espacamento("legenda", est.legenda_track / est.k) * est.k
                f = fonte(tam, est.legenda_peso, papel="legenda")
                while largura_texto(txt, f, trk) > 0.86 * est.W and tam > 20:
                    tam = int(tam * 0.93)
                    f = fonte(tam, est.legenda_peso, papel="legenda")
                im = desenha_texto(txt, f, trk, sombra=0.62)
            self.cache[i] = im
        return self.cache[i]

    def desenha(self, frame, t, cy_legenda):
        est = self.est
        for i, e in enumerate(self.ev):
            if not (e["s"] <= t < e["e"]):
                continue
            im = self.imagem(i)
            dt = t - e["s"]
            resta = e["e"] - t
            if e["tipo"] == "titulo":
                n = 8 / FPS
                p = min(1.0, dt / n)
                q = 1 - (1 - p) ** 2
                sai = min(1.0, resta / (3 / FPS))
                if p < 1:
                    esc = 1.10 - 0.10 * q
                    raio = 26 * est.k * (1 - q)
                    tmp = im.resize((max(1, int(im.width * esc)), max(1, int(im.height * esc))), Image.BILINEAR)
                    if raio > 0.5:
                        tmp = tmp.filter(ImageFilter.GaussianBlur(raio))
                    arr = np.array(tmp)
                else:
                    arr = self.cache.setdefault(("arr", i), np.array(im))
                cy = e.get("y", 0.46) * est.H
                cola(frame, arr, est.W / 2, cy, alpha=q * sai)
            else:
                p = min(1.0, dt / (3 / FPS))
                if p < 1:
                    esc = 0.86 + 0.14 * p
                    arr = np.array(im.resize((max(1, int(im.width * esc)), max(1, int(im.height * esc))), Image.BILINEAR))
                else:
                    arr = self.cache.setdefault(("arr", i), np.array(im))
                cola(frame, arr, est.W / 2, cy_legenda * est.H, alpha=p)


def mascara_divisao(est):
    y = np.arange(est.H) / est.H
    m = np.clip((est.divisao_fim - y) / (est.divisao_fim - est.divisao_topo), 0, 1)
    m = m * m * (3 - 2 * m)
    return m[:, None, None].astype(np.float32)


def render(caminho_roteiro, previa=False):
    cfg = json.load(open(caminho_roteiro))
    pasta = os.path.dirname(os.path.abspath(caminho_roteiro))
    nome = cfg.get("nome") or os.path.basename(pasta)
    configura_fontes(cfg.get("fontes"), pasta)
    larg = 540 if previa else 1080
    est = Estilo(larg)
    W, H = est.W, est.H
    arq = lambda x: x if os.path.isabs(x) else os.path.join(pasta, x)

    # ---- linha do tempo base
    fala = cfg.get("fala")
    cenas = []        # (inicio_saida, fim_saida, fonte, inicio_fonte, zoom, extra)
    palavras = []
    voz_saida = []
    if fala:
        fala = arq(fala)
        dur_fonte = duracao(fala)
        print("• transcrevendo a fala…")
        tr = transcrever(fala)
        trechos = trechos_da_fala(tr, cfg, dur_fonte)
        fx, fy = centro_do_rosto(fala, dur_fonte)
        print(f"• {len(trechos)} trechos mantidos, rosto em x={fx:.2f} y={fy:.2f}")
        acc = 0.0
        ultimo_zoom_t, zoom = -99, 1.0
        alternar = cfg.get("zoom_alternado", True)
        for a, b in trechos:
            partes = [(a, b)]
            if b - a > 7.0 and alternar:
                meio = (a + b) / 2
                ws = [w for w in tr["palavras"] if a + 2 < w["s"] < b - 2]
                if ws:
                    meio = min(ws, key=lambda w: abs(w["s"] - meio))["s"] - 0.02
                partes = [(a, meio), (meio, b)]
            for x, y in partes:
                if alternar and acc - ultimo_zoom_t >= 2.0:
                    zoom = est.zoom_fechado if zoom == 1.0 else 1.0
                    ultimo_zoom_t = acc
                cenas.append({"s": acc, "e": acc + y - x, "fonte": fala, "fs": x, "zoom": zoom})
                acc += y - x
        dur_total = acc
        for w in tr["palavras"]:
            s, e = mapeia(trechos, w["s"]), mapeia(trechos, w["e"])
            if e - s > 0.02 or any(a <= w["s"] <= b for a, b in trechos):
                palavras.append({"p": w["p"], "s": s, "e": max(e, s + 0.08)})
        voz_saida = [(mapeia(trechos, a), mapeia(trechos, b)) for a, b in tr["voz"]]
    else:
        trechos = []
        fx, fy = 0.5, 0.4
        acc = 0.0
        for c in cfg.get("sequencia", []):
            fa = arq(c["arquivo"])
            fs = float(c.get("inicio", 0))
            fe = float(c["fim"]) if "fim" in c else fs + float(c.get("duracao", 3))
            cenas.append({"s": acc, "e": acc + fe - fs, "fonte": fa, "fs": fs, "zoom": 1.0,
                          "mov": c.get("movimento", "entrar")})
            acc += fe - fs
        dur_total = acc

    # ---- textos
    eventos = eventos_de_texto(palavras, cfg.get("titulos", []), dur_total) if palavras else []
    for t in cfg.get("textos", []):
        ev = {"s": float(t["inicio"]), "e": float(t["fim"])}
        if t.get("titulo") or t.get("destaque"):
            txt = t["texto"]
            dest = t.get("destaque") or max(txt.split(), key=len)
            i = txt.find(dest)
            ev.update(tipo="titulo", antes=txt[:i].strip(), destaque=dest, depois=txt[i + len(dest):].strip())
            if "y" in t:
                ev["y"] = t["y"]
        else:
            ev.update(tipo="legenda", texto=t["texto"])
        eventos.append(ev)
    eventos.sort(key=lambda e: e["s"])
    textos = Textos(est, eventos)

    # ---- inserções (b-roll)
    norm_pal = [normaliza(w["p"]) for w in palavras]
    inserts = []
    for ins in cfg.get("insercoes", []):
        if "na_palavra" in ins:
            alvo = normaliza(ins["na_palavra"])
            depois_de = float(ins.get("depois_de", 0))
            k = next((i for i, n in enumerate(norm_pal) if n == alvo and palavras[i]["s"] >= depois_de), None)
            if k is None:
                print(f"  aviso: palavra {ins['na_palavra']!r} não encontrada; inserção ignorada", file=sys.stderr)
                continue
            s = max(0.0, palavras[k]["s"] - 0.08)
        else:
            s = float(ins["inicio"])
        e = float(ins["fim"]) if "fim" in ins else s + float(ins.get("duracao", 3))
        inserts.append({"s": s, "e": min(e, dur_total), "arquivo": arq(ins["arquivo"]),
                        "fs": float(ins.get("inicio_arquivo", 0)), "modo": ins.get("modo", "dividida"),
                        "mov": ins.get("movimento", "entrar")})

    fim_card = cfg.get("encerramento", True)
    dur_card = 1.6 if fim_card else 0.0
    dur_video = dur_total + dur_card
    n_quadros = int(round(dur_video * FPS))
    print(f"• duração final {dur_video:.1f}s ({n_quadros} quadros), {len(eventos)} textos, {len(inserts)} inserções")

    # ---- áudio
    print("• montando áudio…")
    audio = monta_audio(cfg, cenas, fala, trechos, voz_saida, dur_total, dur_video, arq)
    os.makedirs(os.path.join(RAIZ, "saida"), exist_ok=True)
    wav = os.path.join(RAIZ, "saida", f".{nome}.wav")
    grava_wav(wav, audio)

    # ---- vídeo
    saida = os.path.join(RAIZ, "saida", f"{nome}{'_previa' if previa else ''}.mp4")
    enc = [FF, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-i", wav, "-map", "0:v", "-map", "1:a",
           "-c:v", "libx264", "-preset", "veryfast" if previa else "medium", "-crf", "23" if previa else "17",
           "-pix_fmt", "yuv420p", "-profile:v", "high", "-c:a", "aac", "-b:a", "192k",
           "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-movflags", "+faststart", "-shortest", saida]
    proc = subprocess.Popen(enc, stdin=subprocess.PIPE)

    marca_cor = marca_dagua(est, True)
    marca_bra = marca_dagua(est, False)
    card = cartao_final(est)
    mask = mascara_divisao(est)
    leitores = {}
    ultimo = None
    ultimo_cy = est.legenda_y

    def leitor_cena(c):
        chave = ("c", id(c))
        if chave not in leitores:
            for k in [k for k in leitores if k[0] == "c"]:
                leitores.pop(k).fecha()
            if c["fonte"] == fala:
                leitores[chave] = LeitorVideo(fala, W, H, c["fs"])
            else:
                leitores[chave] = Midia(c["fonte"], W, H, c["fs"], c["e"] - c["s"], c.get("mov", "entrar"))
        return leitores[chave]

    def leitor_ins(ins):
        chave = ("i", id(ins))
        if chave not in leitores:
            leitores[chave] = Midia(ins["arquivo"], W, H, ins["fs"], ins["e"] - ins["s"], ins["mov"])
        return leitores[chave]

    for fi in range(n_quadros):
        t = fi / FPS
        if t < dur_total:
            c = next((c for c in cenas if c["s"] <= t < c["e"]), cenas[-1])
            lc = leitor_cena(c)
            if isinstance(lc, LeitorVideo):
                base = lc.quadro(int(round((t - c["s"]) * FPS)))
                base = aplica_zoom(base, c["zoom"], fx, fy)
            else:
                base = lc.quadro(t - c["s"])
            frame = base.copy()
            cy = est.legenda_y
            ativo = next((x for x in inserts if x["s"] <= t < x["e"]), None)
            for x in [x for x in inserts if t >= x["e"] and ("i", id(x)) in leitores]:
                leitores.pop(("i", id(x))).fecha()
            if ativo:
                b = leitor_ins(ativo).quadro(t - ativo["s"])
                if ativo["modo"] == "cheia" or not fala:
                    frame = b.copy()
                else:
                    # apresentadora maior e descida para a metade de baixo
                    rosto, (_, ry) = aplica_zoom(base, 1.22, fx, fy, com_posicao=True)
                    desloc = int(round((est.rosto_dividida - ry) * H))
                    desl = np.roll(rosto, desloc, axis=0)
                    if desloc > 0:
                        desl[:desloc] = rosto[:1]
                    elif desloc < 0:
                        desl[desloc:] = rosto[-1:]
                    frame = (b.astype(np.float32) * mask + desl.astype(np.float32) * (1 - mask)).astype(np.uint8)
                    cy = (est.divisao_topo + est.divisao_fim) / 2 + 0.005
                # entrada e saída suaves da inserção
                d_in, d_out = t - ativo["s"], ativo["e"] - t
                f = min(1.0, d_in / (4 / FPS), d_out / (4 / FPS))
                if f < 1:
                    frame = (frame.astype(np.float32) * f + base.astype(np.float32) * (1 - f)).astype(np.uint8)
            textos.desenha(frame, t, cy)
            m = marca_cor if t < 1.5 else marca_bra
            colar_em(frame, m, int(W - m.shape[1] - 48 * est.k), int(est.marca_y * H - m.shape[0] / 2), 0.9)
            ultimo = frame
            ultimo_cy = cy
        else:
            p = min(1.0, (t - dur_total) / 0.45)
            q = p * p * (3 - 2 * p)
            fr = cv2.GaussianBlur(ultimo, (0, 0), 1 + 18 * est.k * q)
            frame = (fr.astype(np.float32) * (1 - 0.72 * q)).astype(np.uint8)
            cola(frame, card, W / 2, H * 0.5, alpha=q)
        proc.stdin.write(np.ascontiguousarray(frame).tobytes())
        if fi % (FPS * 5) == 0:
            print(f"  {t:5.1f}s / {dur_video:.1f}s", flush=True)
    for l in leitores.values():
        l.fecha()
    proc.stdin.close()
    proc.wait()
    os.remove(wav)
    print(f"✔ pronto: {saida}")
    return saida


def monta_audio(cfg, cenas, fala, trechos, voz_saida, dur_total, dur_video, arq):
    n = int(dur_video * SR) + SR
    mix = np.zeros((n, 2), np.float32)
    voz = np.zeros(n, np.float32)
    if fala and tem_audio(fala):
        a = le_audio(fala)
        pos = 0
        rampa = int(0.012 * SR)
        for x, y in trechos:
            seg = a[int(x * SR):int(y * SR)].copy()
            if len(seg) > 2 * rampa:
                env = np.ones(len(seg), np.float32)
                env[:rampa] = np.linspace(0, 1, rampa)
                env[-rampa:] = np.linspace(1, 0, rampa)
                seg *= env[:, None]
            mix[pos:pos + len(seg)] += seg[:n - pos]
            pos += len(seg)
        for s, e in voz_saida:
            voz[int(s * SR):int(e * SR)] = 1.0
    else:
        # sem fala: usa o som original das cenas, se pedido
        if cfg.get("som_das_cenas", False):
            for c in cenas:
                if tem_audio(c["fonte"]):
                    seg = le_audio(c["fonte"], inicio=c["fs"], dur=c["e"] - c["s"])
                    p = int(c["s"] * SR)
                    mix[p:p + len(seg)] += seg[:n - p]
    musica = cfg.get("musica")
    if musica:
        m = le_audio(arq(musica), inicio=float(cfg.get("musica_inicio", 0)))
        if len(m):
            reps = int(np.ceil(n / len(m)))
            m = np.tile(m, (reps, 1))[:n]
            vol_fundo = float(cfg.get("volume_musica", 0.16 if fala else 0.9))
            vol_livre = float(cfg.get("volume_musica_sem_fala", 0.32 if fala else 0.9))
            k = int(0.25 * SR)
            suave = np.convolve(voz, np.ones(k) / k, mode="same") if fala else np.zeros(n)
            ganho = vol_livre + (vol_fundo - vol_livre) * np.clip(suave * 1.5, 0, 1)
            fi = int(0.6 * SR)
            ganho[:fi] *= np.linspace(0, 1, fi)
            fo0, fo1 = int((dur_video - 1.4) * SR), int(dur_video * SR)
            ganho[fo0:fo1] *= np.linspace(1, 0, fo1 - fo0)
            ganho[fo1:] = 0
            mix += m * ganho[:, None]
    return mix[:int(dur_video * SR)]


def grava_wav(caminho, audio):
    pico = np.max(np.abs(audio)) if len(audio) else 0
    if pico > 0.99:
        audio = audio * (0.99 / pico)
    import wave
    with wave.open(caminho, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((audio * 32767).astype(np.int16).tobytes())


def cmd_transcrever(arquivo):
    tr = transcrever(arquivo, cache=False)
    print(f"Duração: {tr['duracao']:.1f}s — {len(tr['palavras'])} palavras\n")
    linha, t0 = [], None
    for w in tr["palavras"]:
        if t0 is None:
            t0 = w["s"]
        linha.append(w["p"])
        if re.search(r"[.!?]$", w["p"]) or len(linha) > 14:
            print(f"[{t0:6.2f}] {' '.join(linha)}")
            linha, t0 = [], None
    if linha:
        print(f"[{t0:6.2f}] {' '.join(linha)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("transcrever")
    a.add_argument("arquivo")
    b = sub.add_parser("render")
    b.add_argument("roteiro")
    b.add_argument("--previa", action="store_true", help="renderiza em 540x960, mais rápido")
    args = ap.parse_args()
    if args.cmd == "transcrever":
        cmd_transcrever(args.arquivo)
    else:
        render(args.roteiro, args.previa)


if __name__ == "__main__":
    main()
