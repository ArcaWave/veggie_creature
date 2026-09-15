# 변형(경우의 수) 캐릭터 카탈로그

아이들 만들기 키트 구성: **머리(모자) + 몸통(메인 야채) + 팔다리**.
매칭은 **몸통(메인 야채)의 색·종류**를 기준으로 판단한다 (부속은 무시).

클립 파일: `public/variants/<id>.greet.gif`(인사) / `<id>.smile.gif`(신남) / `<id>.png`(스틸)
원본 mp4: `variants-src/` · 재생성: `tools/pregen_variants.py` → `tools/finalize_variants.py`

| id | 이름 | 몸통(메인) | 머리(모자) | 카테고리 | 클립 |
|----|------|-----------|-----------|----------|------|
| carrot      | 당근이     | 주황 당근            | 초록 새싹        | 🟠 주황 · 뿌리 · 둥근   | greet, smile |
| broccoli    | 브로콜리   | 초록 줄기            | 몽글 송이        | 🟢 진초록 · 꽃 · 송이   | greet, smile |
| tomato      | 토마토     | 빨강 광택            | 초록 꼭지 모자   | 🔴 빨강 · 열매 · 둥근   | greet, smile |
| potato      | 감자       | 베이지+갈색 주근깨   | (민머리)         | 🟤 베이지 · 뿌리 · 둥근 | greet, smile |
| cucumber    | 오이       | 초록 줄무늬 길쭉     | (민머리)         | 🟢 연초록 · 열매 · 길쭉 | greet, smile |
| eggplant    | 가지       | 보라 광택            | 초록 꼭지 모자   | 🟣 보라 · 열매 · 길쭉둥근 | greet, smile |
| corn        | 옥수수     | 노랑 알갱이          | 수염·껍질잎      | 🟡 노랑 · 곡물 · 길쭉   | greet, smile |
| cauliflower | 콜리플라워 | 크림 흰 송이         | 연두 잎 장식     | ⚪ 흰색 · 꽃 · 송이     | greet, smile |

## 유형 추가/교체 방법
1. `tools/pregen_variants.py`의 `VARIANTS` 목록에 (id, 영어 묘사) 추가
2. `api/_gemini.ts`의 `VARIANT_IDS`에 id 추가
3. `python3 tools/pregen_variants.py images` → `videos` → `animator/venv/bin/python tools/finalize_variants.py`
