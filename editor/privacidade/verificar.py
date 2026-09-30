import cv2, sys, re, unicodedata
from rapidocr_onnxruntime import RapidOCR
def norm(t):
    t=unicodedata.normalize("NFD",t.upper()); t="".join(c for c in t if unicodedata.category(c)!="Mn"); return re.sub(r"\s","",t)
CH=["MAIZA","AIZA","ENIO","ENI0","LIENTE","TELEF","EFONE","ENDERE","DERECO","DUETT","UETTO","IGUAT","GUATE","AP42","8149","9814","9664","1179"]
ocr=RapidOCR(); cap=cv2.VideoCapture(sys.argv[1]); i=0; vaz=0
while True:
    ok,f=cap.read()
    if not ok: break
    if i%4==0:
        r,_=ocr(cv2.resize(f,None,fx=2,fy=2,interpolation=cv2.INTER_CUBIC))
        for b,t,s in r or []:
            n=norm(t)
            if any(k in n for k in CH) or len(re.findall(r"\d",n))>=4:
                vaz+=1; print(f"VAZOU quadro {i} ({i/25:.1f}s) y={int(b[0][1]/2)}: {t}",flush=True)
    i+=1
print("verificacao concluida, quadros",i,"vazamentos",vaz,flush=True)
