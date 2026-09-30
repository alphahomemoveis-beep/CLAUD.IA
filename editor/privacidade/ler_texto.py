import cv2, json, sys
from rapidocr_onnxruntime import RapidOCR
ocr=RapidOCR()
cap=cv2.VideoCapture(sys.argv[1]); passo=3; out={}; i=0
while True:
    ok,fr=cap.read()
    if not ok: break
    if i%passo==0:
        im2=cv2.resize(fr,None,fx=2,fy=2,interpolation=cv2.INTER_CUBIC)
        res,_=ocr(im2)
        out[i]=[[[[p[0]/2,p[1]/2] for p in b],t,float(s)] for b,t,s in (res or [])]
        if i%30==0: print(i,flush=True)
    i+=1
json.dump(out,open(sys.argv[2],"w"),ensure_ascii=False)
print("fim",i)
