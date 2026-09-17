#!/usr/bin/env python3
# Audit every shipped cut-out for leftover studio background:
#  floor  = pale low-saturation pixels at foot level that touch transparency
#  pocket = neutral-white blobs anywhere inside the figure (eye glints excluded by size/darkness around)
#  halo   = share of edge pixels that are much brighter+paler than the pixels just inside them
import glob, os, sys
import numpy as np
from PIL import Image, ImageFilter
ROOT=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),'public','parts')+'/'
def blobs(mask):
    seen=np.zeros_like(mask); out=[]
    ys,xs=np.where(mask)
    for y0,x0 in zip(ys,xs):
        if seen[y0,x0]: continue
        st=[(y0,x0)]; seen[y0,x0]=True; pts=[]
        while st:
            y,x=st.pop(); pts.append((y,x))
            for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                yy,xx=y+dy,x+dx
                if 0<=yy<mask.shape[0] and 0<=xx<mask.shape[1] and mask[yy,xx] and not seen[yy,xx]: seen[yy,xx]=True; st.append((yy,xx))
        out.append(pts)
    return out
rows=[]
for p in sorted(glob.glob(ROOT+'fig_*.png'))+sorted(glob.glob(ROOT+'cute_hat_*.png')):
    a=np.asarray(Image.open(p).convert('RGBA')).astype(int); h,w=a.shape[:2]
    rgb=a[...,:3]; al=a[...,3]; op=al>60; V=rgb.max(axis=2); mn=rgb.min(axis=2); sat=(V-mn)/np.maximum(V,1)
    trans=al<40
    near_t=np.asarray(Image.fromarray((trans*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7)))>127
    floor=op&(sat<0.42)&(V>110); floor[:int(h*0.87)]=False
    floor_n=int((floor&near_t).sum()) if 'fig_' in p else 0
    white=op&(mn>222)&(V-mn<18)
    pockets=[b for b in blobs(white) if len(b)>=60]
    # eye glints sit inside near-black; a background pocket doesn't
    real=[]
    for b in pockets:
        ys=[y for y,x in b]; xs=[x for y,x in b]
        y0,y1,x0,x1=max(0,min(ys)-4),min(h,max(ys)+5),max(0,min(xs)-4),min(w,max(xs)+5)
        ring=V[y0:y1,x0:x1]; dark=(ring<70).mean()
        if dark<0.25: real.append((len(b),(min(xs)+max(xs))//2,(min(ys)+max(ys))//2))
    # halo: edge ring vs inner ring brightness
    inner1=np.asarray(Image.fromarray((op*255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)))>127
    inner2=np.asarray(Image.fromarray((op*255).astype(np.uint8)).filter(ImageFilter.MinFilter(13)))>127
    edge=op&~inner1; ring=inner1&~inner2
    halo=float(((V[edge]>225)&(sat[edge]<0.2)).mean()) if edge.any() else 0
    rows.append((os.path.basename(p),floor_n,real,round(halo,3)))
bad=0
for n,f,pk,hl in rows:
    flag=(f>40) or pk or hl>0.06
    if flag: bad+=1; print(f'{n:40s} floor={f:5d} pockets={pk} halo={hl}')
print('flagged',bad,'of',len(rows))
