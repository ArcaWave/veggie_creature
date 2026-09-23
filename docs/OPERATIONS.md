# 현장 운영 메모 (몽글몽글 가을 놀이터 · 현대백화점 판교)

## 매일 아침

1. 두 PC 모두 크롬을 키오스크 모드로 (소리 자동 재생 허용 + 새 배포 자동 반영):
   - 스캔 스테이션: `open -a "Google Chrome" --args --autoplay-policy=no-user-gesture-required --kiosk "https://veggie-creature.vercel.app/?autoreload"`
   - 월드: `open -a "Google Chrome" --args --autoplay-policy=no-user-gesture-required --kiosk "https://veggie-creature.vercel.app/world.html?autoreload"`
   - `?autoreload`: 새로 배포하면 1~2분 안에 알아서 새로고침한다 (스테이션은 부스가 비었을 때, 월드는
     새 친구 도착·QR 지나가는 중이 아닐 때). 이게 없으면 **배포 후 두 화면 모두 직접 새로고침**할 것 —
     예전 화면이 새 채소를 모르면 다른 채소로 보이거나 모자만 떠다니던 문제가 있었다(지금은 방어됨).
2. 첫 화면에 "🔇 안내 음성이 막혀 있어요"가 보이면 화면을 한 번 클릭.
3. 키보드·마우스는 아이 손이 닿지 않게 (Space/Enter = 촬영 시작, Esc = 전체화면 해제).
4. PC 절전·화면보호기 끄기.

## 행사 전 한 번

- **테스트 데이터 지우기**: 월드는 "가장 최근 10명"이 살고 있는 마을이라, 리허설 때 만든
  캐릭터가 첫날 아침 월드에 그대로 나온다. Supabase → SQL Editor에서
  `delete from creatures where at < <개막 시각 ms>;` (또는 Table Editor에서 행 삭제). 되돌릴 수 없으니 주의.
- 웹캠 확인: 첫 화면 주소에 `?posedebug` → 카메라 줄이 `4:3`이면 넓은 모드.
- 실제 키트(채소 5종 + 스티커)로 인식 확인, 특히 늙은호박 ↔ 양배추.
- 부스에 안내문: "사진은 캐릭터 인식에만 쓰이고 저장하지 않습니다 (인식: Google Gemini)".

## 행사 중·후

- 통계: `https://veggie-creature.vercel.app/api/creatures?stats&since=2026-09-26`
  (전체 인원, 날짜·시간대별, 채소·모자·팔·다리별 — 한국 시간 기준)
- 월드 홍보 이미지: `npm run dev` 후 `node tools/promo_shots.mjs` (4K는 `--2x`) → `.shots/promo/`
- 월드 화면 녹화용 깨끗한 화면: `world.html?clean` (버튼·표시 없음)
- 상태 점검: `/api/creatures?diag=1` (저장소 연결, 마지막 오류)
- 카메라: 끊기거나 멈추면 4초 안에 알아서 다시 연결한다. 몇 번 있었는지는 첫 화면 `?posedebug`
  (카메라 줄 끝 "재연결 N회") 또는 콘솔 `__camHealth()`. 하루에 여러 번이면 USB 케이블·허브·전원 설정 점검.
