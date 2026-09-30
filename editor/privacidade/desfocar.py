import cv2, json, re, sys, unicodedata, subprocess, numpy as np
S=sys.argv[1]; ENT=f"{S}/orig.mp4"; SAI=sys.argv[2]
ALCANCE=int(sys.argv[3]) if len(sys.argv)>3 else 10
cap=cv2.VideoCapture(ENT); frames=[]
while True:
    ok,f=cap.read()
    if not ok: break
    frames.append(f)
N=len(frames); H,W=frames[0].shape[:2]; print("quadros",N,W,H)

# homografias entre quadros vizinhos (i -> i+1)
orb=cv2.ORB_create(3000); bf=cv2.BFMatcher(cv2.NORM_HAMMING,crossCheck=True)
kp=[];ds=[]
for f in frames:
    g=cv2.cvtColor(cv2.resize(f,(W//2,H//2)),cv2.COLOR_BGR2GRAY)
    k,d=orb.detectAndCompute(g,None); kp.append(k); ds.append(d)
Hf=[]
for i in range(N-1):
    Hm=None
    if ds[i] is not None and ds[i+1] is not None:
        m=bf.match(ds[i],ds[i+1])
        if len(m)>=20:
            a=np.float32([kp[i][x.queryIdx].pt for x in m])*2; b=np.float32([kp[i+1][x.trainIdx].pt for x in m])*2
            Hm,inl=cv2.findHomography(a,b,cv2.RANSAC,4.0)
            if inl is None or inl.sum()<25: Hm=None
    Hf.append(Hm)
print("homografias falhas:",sum(h is None for h in Hf))

def norm(t):
    t=unicodedata.normalize("NFD",t.upper()); t="".join(c for c in t if unicodedata.category(c)!="Mn")
    return re.sub(r"\s","",t)
CHAVES=["MAIZA","MAIZ","AIZA","ENIO","ENI0","CLIE","LIENTE","TELEF","LEFON","EFONE","FONE","ENDERE","NDERE","DERECO","DUETT","UETTO","ETTO","IGUAT","GUATE","TEMI","AP42","8149","9814","9664","1179","(67)"]
def sensivel(t):
    n=norm(t)
    if any(k in n for k in CHAVES): return True
    return len(re.findall(r"\d",n))>=4

ocr=json.load(open(f"{S}/ocr.json"))
def estende(b,t):
    b=np.float32(b); n=norm(t); ex=b[1]-b[0]
    tem_nome=any(k in n for k in ["MAIZ","AIZA"]); tem_enio=any(k in n for k in ["ENIO","ENI0","EN10"])
    if tem_nome and not tem_enio and "TELEF" not in n:
        b[1]+=ex*1.4; b[2]+=ex*1.4
    if tem_enio and not tem_nome and "(67)" not in n and "1179" not in n:
        b[0]-=ex*2.2; b[3]-=ex*2.2
    if "CLIE" in n and not tem_nome:
        b[1]+=ex*2.5; b[2]+=ex*2.5
    return b
det={int(k):[estende(b,t) for b,t,s in v if sensivel(t)] for k,v in ocr.items()}
print("deteccoes:",sum(len(v) for v in det.values()))

def expande(p):
    c=p.mean(0); v=p-c
    # eixo da linha de texto
    ex=(p[1]-p[0]); ey=(p[3]-p[0]); lx=np.linalg.norm(ex)+1e-6; ly=np.linalg.norm(ey)+1e-6
    ux, uy = ex/lx, ey/ly
    padx=6+0.04*lx; pady=5+0.35*ly
    q=[]
    for pt,sx,sy in zip(p,[-1,1,1,-1],[-1,-1,1,1]):
        q.append(pt+ux*sx*padx+uy*sy*pady)
    return np.float32(q)

mascaras=[np.zeros((H,W),np.uint8) for _ in range(N)]
def aplica(Hm,pts): return cv2.perspectiveTransform(pts.reshape(-1,1,2),Hm).reshape(-1,2)
for j,lst in det.items():
    for p in lst:
        p=expande(p)
        cv2.fillPoly(mascaras[j],[np.int32(p)],255)
        q=p.copy()
        for i in range(j,min(N-1,j+ALCANCE)):      # para frente
            if Hf[i] is None: break
            q=aplica(Hf[i],q); cv2.fillPoly(mascaras[i+1],[np.int32(q)],255)
        q=p.copy()
        for i in range(j-1,max(-1,j-1-ALCANCE),-1):  # para trás
            if Hf[i] is None: break
            q=aplica(np.linalg.inv(Hf[i]),q); cv2.fillPoly(mascaras[i],[np.int32(q)],255)

cmd=["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","bgr24","-s",f"{W}x{H}","-r","25","-i","-","-i",ENT,
     "-map","0:v","-map","1:a?","-c:v","libx264","-crf","17","-preset","medium","-pix_fmt","yuv420p","-c:a","copy","-movflags","+faststart",SAI]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
for i,f in enumerate(frames):
    m=mascaras[i]
    if m.any():
        m=cv2.dilate(m,np.ones((5,5),np.uint8))
        a=cv2.GaussianBlur(m,(0,0),4).astype(np.float32)[...,None]/255
        pequeno=cv2.resize(f,(W//4,H//4),interpolation=cv2.INTER_AREA)
        bl=cv2.GaussianBlur(pequeno,(0,0),3.5)
        bl=cv2.GaussianBlur(cv2.resize(bl,(W,H),interpolation=cv2.INTER_LINEAR),(0,0),3)
        f=(f*(1-a)+bl*a).astype(np.uint8)
    p.stdin.write(f.tobytes())
p.stdin.close(); p.wait()
np.save(f"{S}/cobertura.npy",np.array([m.mean()/255 for m in mascaras]))
print("pronto",SAI)
