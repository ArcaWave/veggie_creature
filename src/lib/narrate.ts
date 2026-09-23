import { sfxEnabled } from "./sfx";

// The kiosk's VOICE: recorded guide lines (public/voice/*.mp3), for an
// exhibition nobody attends. The rules that keep it tidy on its own:
//   • ONE voice at a time, ever. narrate() cuts whatever is speaking (a short
//     fade, no click) and starts the new line — a new scene's line always
//     replaces the old scene's, there is no queue that could trail behind.
//   • A cut line's callbacks never fire (every play has a ticket; a stale
//     ticket is ignored), so a sequence can't continue into the wrong scene.
//   • The SCREEN never waits on audio. Timing comes from the table below
//     (measured from the files), so a muted / blocked / missing clip changes
//     nothing about the flow — the on-screen text carries it.
//   • Browsers refuse sound before a gesture: a refused play marks the voice
//     `blocked` (the welcome screen says so to staff) and the first click or
//     key anywhere unlocks it for the rest of the day. A kiosk Chrome started
//     with --autoplay-policy=no-user-gesture-required never blocks.
//   • The 🔈 button mutes it together with the sound effects.
// skip = leading silence to jump over (s), ms = how long the line takes to say
// (from the jump to the last word), gain = levels the clips against each other.
const CLIPS = {
  w1_hello: { skip: 0.2, ms: 4210, gain: 0.75 },    // 안녕! 채소 친구를 만들었니? 화면 앞으로 가까이 와 봐!
  w2_show: { skip: 0.15, ms: 3100, gain: 0.62 },    // 네가 만든 채소 친구를, 들어서 화면에 보여 줘!
  w3_still: { skip: 0.15, ms: 2950, gain: 0.8 },    // 좋아! 움직이지 말고 그대로~ 사진 찍을게!
  w4_count: { skip: 0.09, ms: 1400, gain: 0.68 },   // 셋! 둘! 하나!
  w5_snap: { skip: 0.16, ms: 600, gain: 0.68 },     // 찰칵!
  m1_reading: { skip: 0.15, ms: 3510, gain: 0.65 }, // 어떤 채소 친구일까? 마법으로 알아보는 중이야~
  m2_noshow: { skip: 0.18, ms: 4120, gain: 0.77 },  // 어라? 채소 친구가 잘 안 보여! 조금만 더 가까이 보여 줄래?
  d0_intro: { skip: 0.16, ms: 3650, gain: 0.92 },   // 이제 마법 동작 세 가지로, 친구에게 생명을 불어넣자!
  d1_airplane: { skip: 0.14, ms: 3910, gain: 0.75 },// 첫 번째 마법! 비행기처럼, 양팔을 옆으로 쭉~ 펴 봐!
  d1_cheer_a: { skip: 0.12, ms: 940, gain: 0.78 },  // 팔이 쑥!
  d1_cheer_b: { skip: 0.16, ms: 860, gain: 0.64 },  // 잘했어!
  d2_heart: { skip: 0.15, ms: 3940, gain: 0.79 },   // 두 번째 마법! 두 손을 머리 위로 모아서, 하트를 만들어 봐!
  d2_cheer: { skip: 0.14, ms: 1710, gain: 0.65 },   // 사랑을 듬뿍 주었어!
  d3_stir: { skip: 0.19, ms: 4660, gain: 0.76 },    // 마지막 마법! 국자를 잡고, 마법 냄비를 빙글빙글 저어 봐!
  d3_hand: { skip: 0.14, ms: 3150, gain: 0.72 },    // 손을 들어 봐! 국자가 손에 착 붙을 거야!
  d_wait: { skip: 0.11, ms: 3520, gain: 0.6 },      // 천천히 해도 괜찮아~ 마법 가루가 모이고 있어!
  a1_pang: { skip: 0.12, ms: 540, gain: 0.79 },     // 팡!
  a1_done: { skip: 0.14, ms: 1070, gain: 0.72 },    // 마법 완성!
  a1_wow: { skip: 0.18, ms: 560, gain: 0.46 },      // 우와~
  a1_alive: { skip: 0.15, ms: 1510, gain: 0.73 },   // 채소 친구가 살아났어!
  a2_go: { skip: 0.18, ms: 1800, gain: 0.79 },      // 이제 디지털 세계로 출발~!
  a3_look: { skip: 0.19, ms: 4770, gain: 1.0 },     // 옆에 있는 큰 화면에서, 네 친구를 찾아봐! 안녕~ 또 만나!
} as const;
export type VoiceId = keyof typeof CLIPS;

// when each number is SAID in w4_count (ms after the clip starts): the screen's
// 3-2-1 follows the voice, not a metronome
const COUNT_MARKS = { 3: 60, 2: 510, 1: 890, snap: 1480 } as const;

const VOLUME = (() => { // ?voicevol=0.8 (the TV's own volume does the rest)
  const v = Number(new URLSearchParams(location.search).get("voicevol"));
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
})();
const VOICE_OFF = new URLSearchParams(location.search).get("voice") === "0";

const pool = new Map<VoiceId, HTMLAudioElement>();
function element(id: VoiceId): HTMLAudioElement {
  let el = pool.get(id);
  if (!el) {
    el = new Audio(`/voice/${id}.mp3`);
    el.preload = "auto";
    pool.set(id, el);
  }
  return el;
}
// warm every clip once, so the first line of a scene starts at once
export function preloadVoice() {
  if (VOICE_OFF) return;
  (Object.keys(CLIPS) as VoiceId[]).forEach((id) => element(id).load());
}

// ?voicelog: every line said / cut / finished lands in window.__voiceLog, and
// window.__voicePlaying() lists the clips actually sounding — how "one voice at
// a time" and "a new scene cuts the old line" are verified, not assumed
const LOG = new URLSearchParams(location.search).has("voicelog");
const t00 = performance.now();
const log = (ev: string, id: string) => { if (LOG) ((window as any).__voiceLog ??= []).push({ t: Math.round(performance.now() - t00), ev, id }); };
if (LOG) (window as any).__voicePlaying = () => [...pool].filter(([, el]) => !el.paused && !el.ended && el.volume > 0.05).map(([id]) => id);

let ticket = 0;                       // every play gets one; an old one is void
let current: { id: VoiceId; el: HTMLAudioElement; timer: number } | null = null;
let blocked = false;
const blockedListeners = new Set<(b: boolean) => void>();
const setBlocked = (b: boolean) => { if (b !== blocked) { blocked = b; blockedListeners.forEach((f) => f(b)); } };
export const voiceBlocked = () => blocked;
export function onVoiceBlocked(f: (b: boolean) => void) { blockedListeners.add(f); return () => { blockedListeners.delete(f); }; }

// the first gesture of the day unlocks sound for good
for (const ev of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(ev, () => setBlocked(false), { passive: true });
}

function fadeOut(el: HTMLAudioElement, ms: number) {
  const v0 = el.volume, t0 = performance.now();
  const step = () => {
    const k = (performance.now() - t0) / ms;
    if (k >= 1 || el.paused) { el.pause(); return; }
    el.volume = v0 * (1 - k);
    requestAnimationFrame(step);
  };
  if (ms <= 0) el.pause(); else step();
}

// In a sequence, the wait between one line's timer and the next line's start. A clip's `ms` runs 0.12 s
// past its last word and its `skip` lands 0.06 s before its first, so a requested SILENCE between the
// words (pauseS, seconds) is that minus 0.18 s. Without pauseS: the house default (0.25 s wait).
const SEQ_GAP_MS = 250;
const gapFor = (pauseS?: number) => (pauseS === undefined ? SEQ_GAP_MS : Math.max(0, Math.round(pauseS * 1000) - 180));
// how long a line (or a sequence of lines, with the pause between them) takes to say — for timing a screen to it
export const clipMs = (id: VoiceId | VoiceId[], pauseS?: number) =>
  Array.isArray(id) ? id.reduce((t, x) => t + CLIPS[x].ms, 0) + gapFor(pauseS) * Math.max(0, id.length - 1) : CLIPS[id].ms;
export const narrating = (): VoiceId | null => current?.id ?? null;

// stop talking, now (scene change with nothing new to say, unmount, mute)
export function hush(fadeMs = 90) {
  ticket++;
  if (!current) return;
  log("cut", current.id);
  clearTimeout(current.timer);
  fadeOut(current.el, fadeMs);
  current = null;
}

// Say a line NOW, cutting whatever is being said. An array is said in order
// (the rest is dropped the moment anything else speaks), pauseS = the silence
// between them in seconds. onEnd fires when the (last) line has been said —
// never if it was cut.
export function narrate(what: VoiceId | VoiceId[], onEnd?: () => void, pauseS?: number) {
  const [id, ...rest] = Array.isArray(what) ? what : [what];
  hush();
  const mine = ++ticket;
  const clip = CLIPS[id];
  const el = element(id);
  // the line's END is a timer from the table, not an audio event: the flow is
  // the same whether the clip plays, is muted, is blocked or failed to load
  const timer = window.setTimeout(() => {
    if (mine !== ticket) return;
    log("said", id);
    fadeOut(el, 120); // the words are out: close the clip's silent tail, so the next line never shares the air with it
    current = null;
    if (rest.length) narrate(rest, onEnd, pauseS);
    else onEnd?.();
  }, clip.ms + (rest.length ? gapFor(pauseS) : 0));
  current = { id, el, timer };
  log("say", id);
  if (VOICE_OFF || !sfxEnabled()) return;
  try {
    el.currentTime = clip.skip;
    el.volume = Math.min(1, clip.gain * VOLUME);
    el.play().then(() => setBlocked(false)).catch((e) => { if (e?.name === "NotAllowedError") setBlocked(true); });
  } catch { /* a clip that can't play is a line unsaid — the screen carries on */ }
}

// "셋! 둘! 하나!" with the screen's numbers landing on the spoken ones, then
// onSnap. Returns a cancel (walked away mid-count): nothing more fires.
export function voicedCountdown(onNumber: (n: 3 | 2 | 1) => void, onSnap: () => void): () => void {
  const timers: number[] = [];
  let cancelled = false;
  narrate("w4_count");
  ([3, 2, 1] as const).forEach((n) => timers.push(window.setTimeout(() => !cancelled && onNumber(n), COUNT_MARKS[n])));
  timers.push(window.setTimeout(() => !cancelled && onSnap(), COUNT_MARKS.snap));
  return () => { cancelled = true; timers.forEach(clearTimeout); hush(); };
}
