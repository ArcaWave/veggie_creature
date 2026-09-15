#!/bin/bash
# ── 스캔 PC 원클릭 실행 (Mac) ──────────────────────────────
# 더블클릭 한 번으로: 절전 방지 + 로컬 서버 기동 + 크롬 키오스크.
# 배포 주소를 쓰려면 아래 URL만 바꾸면 됩니다 (서버 기동은 자동 생략).
URL="http://localhost:5180"

cd "$(dirname "$0")/.."
caffeinate -dis &                       # 행사 중 잠들지 않게

if [[ "$URL" == *localhost* ]]; then
  if ! curl -s -o /dev/null "$URL"; then
    echo "로컬 서버 시작 중…"
    PATH="/opt/homebrew/bin:$PATH" npm run dev > /tmp/veggie-dev.log 2>&1 &
    for i in $(seq 1 30); do curl -s -o /dev/null "$URL" && break; sleep 1; done
  fi
fi

# 카메라 권한을 기억해야 하므로 --incognito 는 쓰지 않습니다.
open -na "Google Chrome" --args --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble "$URL"
echo "종료하려면 크롬에서 ⌘Q"
