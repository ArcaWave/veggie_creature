#!/usr/bin/env python3
# The QR sign's code, as a module matrix: public/fx/qr_matrix.json (world.html draws it crisply at any
# size). Re-run with a new QR image when the link changes:  python3 tools/qr_matrix.py tools/qr_source.png
# Handles a plain QR image with or without a quiet zone / a dark frame. PIL + numpy only.
import json, os, sys
import numpy as np
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
a = np.asarray(Image.open(sys.argv[1]).convert("L")) < 128
# strip a dark frame (rows / columns that are dark all the way across)
while a[0].all(): a = a[1:]
while a[-1].all(): a = a[:-1]
while a[:, 0].all(): a = a[:, 1:]
while a[:, -1].all(): a = a[:, :-1]
ys, xs = np.where(a); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
a = a[y0:y1, x0:x1]
# module size = the finder pattern's outer ring: the first dark run of the top row is 7 modules wide
row = a[2]; run = 0
for v in row:
    if v: run += 1
    else: break
m = run / 7
N = round(a.shape[1] / m)
M = [[bool(a[int((y + 0.5) * m), int((x + 0.5) * m)]) for x in range(N)] for y in range(N)]
assert N in (21, 25, 29, 33, 37, 41), f"odd module count {N}"
json.dump(M, open(os.path.join(ROOT, "public", "fx", "qr_matrix.json"), "w"), separators=(",", ":"))
print(f"{N}x{N} modules, {sum(map(sum, M))} dark →", os.path.join("public", "fx", "qr_matrix.json"))
