# AI Suggestiveness 실험 (전시 체험 안에서)

전시 체험은 그대로 두고, 그 안에서 실험이 함께 돌아간다. **체험하는 모든 아이가 참가자**다.

```
첫 화면 → 사진·인식 → 동작 3개(비행기·하트·국자) → "살아났다!" → 월드로 출발 → 마무리 화면
                                                        └ 여기에 실험이 들어간다
```

"살아났다!" 장면 (모든 아이 똑같이):
1. 냄비의 흰 화면에서 아이의 클레이 캐릭터가 받침대 위로 "뿅" — "우와~ 채소 친구가 살아났어!"
2. 캐릭터가 **배정된 영상 1개**를 한다 (5.6초, 소리·글자 없음) — 6개 중 하나
3. 끝 자세 그대로 **관찰 6초** (소리 없음)
4. 원래대로 월드로 출발 → 마무리 화면

사진을 찍는 순간 참가자 ID(`MK_0001`…)와 조건(Pair A/B/C × HIGH/LOW)이 자동으로 정해지고, 단계마다 시각이
자동으로 기록된다. 연구자는 아무것도 누를 필요가 없다 — 사람만 알 수 있는 것(나이, Q1–Q6 답, 자발적 발화,
예외)만 **연구자 콘솔**에 적는다.

| 화면 | 주소 |
|---|---|
| 스테이션 (체험) | `/?autoreload&key=연구키` — 키는 처음 한 번 |
| 연구자 콘솔 | `/?research=console&key=연구키` — 태블릿·노트북 |
| 자극 확인 | `/?research=demo` — 6개 영상 + 비교표 |

## 1. 준비 (한 번)

1. **Supabase에 표 2개** — SQL Editor에 붙여 넣고 실행:

   ```sql
   create table if not exists research_state (
     key text primary key,
     rev integer not null default 1,
     data jsonb not null,
     updated_at timestamptz not null default now()
   );
   create table if not exists research_sessions (
     participant_id text primary key,
     seq integer not null,
     rev integer not null default 1,
     data jsonb not null,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   );
   -- 정책 없이 RLS만 켠다: 서버(서비스 키)만 읽고 쓰고, 공개 키로는 아무것도 못 본다
   alter table research_state enable row level security;
   alter table research_sessions enable row level security;
   ```

2. **Vercel 환경변수 `RESEARCH_KEY`** — 연구팀만 아는 긴 문자열 (예: `openssl rand -hex 16`). 저장 후 다시 배포.
3. 스테이션과 콘솔을 `&key=…`를 붙여 한 번 연다 (그 기기에 저장된다).

준비가 안 됐거나 와이파이가 끊겨도 **체험은 멈추지 않는다**: 스테이션이 조건을 그 자리에서 뽑아 영상을 틀고, 그
세션을 PC에 보관했다가 서버가 다시 닿을 때 넘긴다 (`OFF-…`, `offline = true`, 균형 배정 밖이라 분석에서 따로 본다).

## 2. 연구자가 하는 일

- **Q1**: 아이가 체험을 시작하기 전에 묻는다. 사진을 찍으면 콘솔 "지금 진행 중"에 ID가 뜨니, 그 세션에 Q1 답을 적는다.
- **영상·관찰 시간**: 콘솔이 "말을 걸거나 가리키지 마세요" / 관찰 6초 카운트다운을 보여준다. 아이가 스스로 한 말은
  "관찰 시간 자발적 발화"에 그대로 적는다 (적으면 "있음"이 자동으로 켜진다).
- **Q2–Q6**: 아이가 월드로 출발한 뒤 묻는다. 콘솔은 직접 고른 세션을 계속 붙잡고 있다 (다음 아이가 시작해도 넘어가지 않음 —
  "진행 중인 세션으로"를 눌러야 넘어간다). Q2를 마치면 **Q2 완료**를 체크한다.
- **조건은 Q2 완료 전까지 가려진다**. "지금 보기"로 볼 수 있지만, 본 사실이 기록된다(`condition_revealed_early`).
  기록 표의 "조건 표시"는 책임연구자용.
- **예외**: 기술적 오류 · 영상이 중간에 끊김 · 연구자 개입 · 보호자 개입 · 아이가 영상을 보지 않음 + 메모.
- 모든 칸은 적는 대로 저장된다. **CSV 다운로드**로 언제든 받는다 (Excel에서 한글이 바로 열린다).

## 3. 무작위 배정 (논문 방법 절)

- 6개 셀 = 자극 쌍(A 순간이동 / B 날기 / C 식물 키우기) × 조건(HIGH / LOW), 참가자 간 배정.
- **치환 블록 무작위화**: 블록마다 6개 셀이 같은 수(크기 6 블록이면 1번씩, 12면 2번씩), 블록 안 순서는 섞고,
  블록 크기(6/12)도 무작위라 다음 배정을 예측할 수 없다. 배정표는 첫 세션 때 암호학적 난수로 600명분을 만들어
  서버에 저장(자동 연장)하고 순서대로 쓴다. 배정은 사진을 찍는 순간 — 국자를 젓기 훨씬 전에 — 확정된다.
- 중간에 끝난 세션의 배정은 다음 아이에게 넘기지 않는다 (`completed`, `stage_reached`, `end_reason`).
  체험 중 화면이 새로고침되면 그 세션은 `superseded`로 닫힌다.

## 4. 자극

아이의 클레이 캐릭터(인식된 채소 + 스티커 조합 — 체험·월드와 같은 그림)가 "살아났다!" 장면의 받침대 위에서 미리 정한
움직임을 한다 (`src/research/stimuli.ts`, 생성형 AI 없음). 6개 모두 5.6초, 같은 크기·시작/끝 자세, 소리·글자 없음.
배경·빛·먼지 효과는 체험 그대로라 두 조건이 같다. 시간: 등장 → 2.8초(말이 끝나면) 영상 → 5.6초 → 관찰 6초 → 출발.

| Pair | LOW | HIGH |
|---|---|---|
| A 순간이동 | 웅크렸다가 받침대를 크게 깡충깡충 가로질러 감 | 같은 웅크림 → 점점 세게 떨며 살짝 떠오르는 "기 모으기" → 빙글 돌며 점처럼 작아져 사라짐 → 오른쪽에서 점처럼 나타나 빙글, 통! (몸 동작만 — 포털·번개 없음) |
| B 날기 | 같은 웅크림, 같은 체공 시간의 보통 점프 | 같은 웅크림·체공 시간, 높이만 약 3배 (화면 위쪽까지) |
| C 식물 | 화분 옆에서 깡충깡충, 몸 흔들기 — 새싹 그대로 | 화분 쪽으로 몸을 돌려 힘을 모았다가 밀면, 옆에서 반짝이고 빛나는 작은 잎들이 화분으로 날아가고(흙이 잠깐 빛남) 식물이 잎을 하나씩 펼치며 자람 → 기뻐서 깡충 |

(2026-10 피드백 반영: 동작이 더 잘 보이게, 같은 쌍 안의 차이가 분명하게 — 순간이동 전 준비 동작, 점프는 체공 시간이
아니라 높이 차이, 키우기는 캐릭터가 하는 일로 보이는 효과.)

`/?research=demo`의 비교표(캐릭터 3종): 밝기·채도는 몇 % 이내. 움직임 양 — A는 HIGH가 8~23% 적고(LOW가 받침대를
가로지르는 것 자체가 움직임), B는 HIGH가 24~33% 많고(높이 차이 자체), C는 0~9%. 세션마다 **그 아이 캐릭터로 잰, 그
아이가 본 영상의 움직임 양**을 `motion_energy`로 기록 → 분석에서 공변량. 동작 단계는 체험 그대로 3개(비행기·하트·국자) —
비행기 자세가 '날기'를 연상시킬 수 있으나 모든 아이에게 같다.

## 5. 데이터 (CSV 열)

| 열 | 내용 |
|---|---|
| `participant_id`, `seq`, `offline` | MK_0001… (오프라인 세션은 OFF-…), 순번, 서버 밖에서 진행됐는지 |
| `age` | 나이 (콘솔) |
| `condition`, `animation_pair`, `animation_id` | HIGH/LOW, A/B/C, 자극 ID |
| `block`, `block_pos`, `block_size` | 무작위 배정 블록 |
| `source` | 사진이 시작된 방식 (person · held · object · key …) |
| `variant`, `hat`, `arms`, `legs`, `matched` | 인식된 캐릭터, 인식 성공 여부 |
| `session_start_time` … `session_end_time` | 단계 시각(스테이션 시계, UTC): `match_time`, `dance_start_time`, `ladle_start_time`, `ladle_end_time`, `reveal_time`, `animation_start_time`, `animation_end_time`, `observation_end_time`, `walk_off_time` |
| `spontaneous_verbalization(_text)` | 관찰 시간 자발적 발화 (true/false/빈칸), 그대로 |
| `q1_answer`, `q2_answer`, `q3_6_answers`, `q2_done` | 콘솔에 적은 답 |
| `technical_error` … `child_did_not_watch`, `session_aborted` | 예외 (`session_aborted`는 체험이 끝까지 가지 않은 세션) |
| `researcher_note` | 메모 (스테이션의 자동 오류 기록도 여기에) |
| `motion_energy` | **공변량** |
| `condition_revealed_early`, `completed`, `stage_reached`, `end_reason` | Q2 전 조건 확인, 완료, 멈춘 단계와 이유 |

사진·그림은 저장하지 않는다.

## 6. 점검

- `npx tsx tools/research.test.ts` — 배정 균형, 단계·시각, 중단·새로고침, 콘솔 기록, 블라인딩, 오프라인, CSV (26개).
- 로컬(`npm run dev`)은 `.data/research.json`에 따로 저장 — 배포된 표를 건드리지 않고, 키도 필요 없다.
- 스테이션만 실험을 끄려면 주소에 `&exp=0` (예전 "살아났다!" 장면 그대로).
