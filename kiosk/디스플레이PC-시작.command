#!/bin/bash
# ── 디스플레이 PC 원클릭 실행 (Mac) ─────────────────────────
# 아래 URL을 배포 주소로 바꿔주세요. (리허설: http://<스캔PC IP>:5180/world.html)
URL="https://배포주소.vercel.app/world.html"

caffeinate -dis &
open -na "Google Chrome" --args --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --incognito "$URL"
echo "종료하려면 크롬에서 ⌘Q"
