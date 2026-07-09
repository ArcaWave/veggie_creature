# 🥦 Veggie Monster (프로토타입)

아이들이 실제 야채로 만든 몬스터를 사진으로 디지털 세계에 데려와,
정답이 여러 개인 미션을 스스로 풀며 **창의력·문제해결력**을 기르는 놀이.

- **형태**: 앱이 아니라 **QR 링크로 여는 모바일 세로 웹** (1회성 경험)
- **언어**: UI 전부 **영문**
- **여정(일직선)**: Welcome → 촬영 → 클레이 변신 → 깨우기(살아 움직임) → (영상 없으면 눈 붙이기) → 채소·이름 → **미션 1개**(Cross the River) → **공유 가능한 수료증 카드**

자세한 기획은 [PLAN.md](./PLAN.md) 참고.

## 실행
```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # 타입체크 + 프로덕션 빌드
```
모바일 세로(폭 ~460px) 기준 웹. 사진 촬영은 카메라가 있는 기기에서 동작하며,
없으면 "Upload a photo"로 진행됩니다. **카메라는 localhost 또는 https에서만 동작.**

## 배포 (Vercel)
세 API는 **서버리스 함수**(`api/*.ts`)로 동작하고, dev에선 `vite.config.ts`가 같은 로직(`api/_gemini.ts`)을 프록시합니다. 키는 환경변수에만 둡니다(브라우저 노출 없음).

```bash
cd ~/Desktop/vegiemonster
vercel link                       # 스코프(개인/팀) 선택, 프로젝트 연결
vercel env add GEMINI_API_KEY production   # 키 입력 (Veo/이미지용)
#   필요시: vercel env add GEMINI_VIDEO_MODEL production  (기본 veo-3.1-lite-generate-preview)
vercel --prod                     # 배포 → https URL 발급 → 이 URL로 QR 생성
```
- HTTPS 자동 → **카메라·공유 동작**.
- 동시 접속은 CDN·서버리스가 자동 확장.
- 키를 바꾸면 `vercel --prod`로 재배포해야 반영됩니다.

### 보안 / 비용 보호
- 키는 **서버(환경변수)에만** — 클라이언트 번들·git에 없음(`.env` gitignore).
- **레이트리밋**(`api/_ratelimit.ts`, IP당): stylize 15/분, **animate(영상) 4/10분**, status 150/분. 초과 시 `429`. *주의: 인메모리라 서버리스에선 best-effort.*
- **반드시 Google Cloud 결제 한도(budget cap)·쿼터 상한**을 걸 것 — 이게 진짜 하드 상한. 운영용 키는 새로 발급 권장.

## 화면 구조
```
App.tsx (stage: welcome → build → quest → certificate)
src/screens/  Welcome · Build · Quest · Certificate
src/components/MonsterFace  (영상 있으면 루프, 없으면 사진+절차적 눈/모션)
src/api/      stylize(클레이) · animate(영상)
src/data/     veggies(야채→능력) · missions(Cross the River)
```
수료증은 canvas로 PNG 렌더 → `navigator.share`(모바일) 또는 다운로드.

## AI 클레이 변환 (Nano Banana / Gemini)
사진을 클레이 스타일로 바꾸는 "변신" 단계는 Google Gemini 이미지 모델을 사용합니다.

1. https://aistudio.google.com/apikey 에서 API 키 발급
2. 프로젝트 루트의 `.env` 파일에 키 입력:
   ```
   GEMINI_API_KEY=발급받은_키
   GEMINI_IMAGE_MODEL=gemini-2.5-flash-image   # (선택) 모델 변경 가능
   ```
3. `npm run dev` 재시작 (vite.config 변경 시 자동 재시작됨)

- 키는 Vite 개발 서버의 프록시(`/api/stylize`, `vite.config.ts`)에서만 읽혀 **브라우저에 노출되지 않습니다.**
- **키가 없으면** 변신 단계가 원본 사진 그대로 진행됩니다(앱은 정상 동작).
- 참고: 아이 사진을 외부 API로 전송하므로, 실제 서비스화 시 보호자 동의가 필요합니다.

## "깨우기" — 살아 움직이는 영상 (Veo)
변신한 클레이 몬스터를 **한 번** 짧은 루프 영상으로 만들어, 도감·미션 어디서나 반복 재생합니다.

- 만들기 흐름: 사진 → 변신(클레이) → **깨우기(영상)** → (영상 있으면 눈 단계 생략) → 채소 → 이름
- 모델: 기본 `veo-3.1-lite-generate-preview` (가장 저렴, `.env`의 `GEMINI_VIDEO_MODEL`로 변경)
- 비용: **한 마리당 1회** 생성(Lite 8초 ≈ ₩400~600), 이후 **IndexedDB 캐싱**으로 무한 반복 재생 → 추가 비용 0
- 생성 시간: 약 40~90초 (생성 중 "깨어나는 중…" 표시)
- 프록시: `/api/animate`(시작) + `/api/animate-status`(폴링·다운로드). 영상은 16:9로 와서 둥근 프레임에 `object-fit:cover`로 크롭됨
- **폴백**: 키 없음/실패/건너뛰기 시 → 눈 붙이기 + 절차적 모션(숨쉬기·깜빡임)으로 진행. 영상 있는 몬스터는 `MonsterFace`가 영상을, 없으면 사진+눈을 렌더

## 구현된 MVP 흐름
1. **만들기** — 사진(카메라/업로드) → 눈알 붙이기(드래그) → 채소 고르기(→능력) → 이름
2. **도감** — 내가 만든 몬스터 모음 (localStorage 저장)
3. **모험 지도** — 미션 선택, 클리어 시 다음 미션 잠금 해제
4. **미션** — 정답이 여러 개. 알맞은 능력이 없으면 "다시 해보자"로 격려 (실패=정보)

## 핵심 설계
- `src/data/veggies.ts` — 야채 → 능력 변환 도감 (당근=빠르기, 토마토=점프 …)
- `src/data/missions.ts` — 미션과 해결 경로. **경로마다 필요한 능력**이 달라 역설계 사고를 유도
- `src/store.tsx` — localStorage 기반 몬스터/별 저장

## 폴더 구조
```
src/
  components/MonsterFace.tsx   사진+흔들리는 눈알
  screens/  Home · Create · MapScreen · Mission
  data/     veggies · missions
  store.tsx  types.ts  styles.css
```

## 다음 단계 (v1+)
- AI 야채 인식 / 사진 배경 제거(누끼)
- 미션 콘텐츠 확장, 보호자·교사 모드
- 친구와 공유 / 협동 미션
- 연령별 난이도 분기 강화
