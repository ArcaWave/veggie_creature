#!/usr/bin/env python3
# Matching-accuracy harness. Put labelled photos of real kit creations in
#   match-test/<correct-variant>/<any>.jpg     (e.g. match-test/carrot/img1.jpg)
# start the dev server (npm run dev), then run:
#   python3 tools/test_match.py
# Prints per-label accuracy and every miss, so prompt/variant tweaks can be
# measured instead of guessed.
import base64
import glob
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTDIR = os.path.join(ROOT, "match-test")
URL = os.environ.get("MATCH_URL", "http://localhost:5180/api/match")

if not os.path.isdir(TESTDIR):
    sys.exit("match-test/ 폴더가 없습니다. match-test/<정답라벨>/사진.jpg 형태로 넣어주세요.")

total = ok = 0
misses = []
for label_dir in sorted(glob.glob(os.path.join(TESTDIR, "*"))):
    if not os.path.isdir(label_dir):
        continue
    label = os.path.basename(label_dir)
    files = [f for f in glob.glob(os.path.join(label_dir, "*")) if f.lower().endswith((".jpg", ".jpeg", ".png"))]
    hit = 0
    for f in files:
        ext = "png" if f.lower().endswith(".png") else "jpeg"
        img = base64.b64encode(open(f, "rb").read()).decode()
        req = urllib.request.Request(
            URL,
            data=json.dumps({"image": f"data:image/{ext};base64,{img}"}).encode(),
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.load(r)
        except Exception as e:  # noqa: BLE001
            j = {"variant": f"ERROR:{e}"}
        got = j.get("variant")
        total += 1
        if got == label:
            hit += 1
            ok += 1
        else:
            misses.append((os.path.basename(f), label, got, j.get("votes")))
    if files:
        print(f"{label:>14}: {hit}/{len(files)}")

print(f"\n전체 정확도: {ok}/{total} ({ok / max(1, total):.0%})")
if misses:
    print("\n틀린 것들:")
    for name, want, got, votes in misses:
        print(f"  {name}: 정답 {want} → 판정 {got}  votes={votes}")
