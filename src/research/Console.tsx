// The researchers' console for the experiment inside the kiosk (/?research=console — a tablet or a laptop).
// The kiosk runs on its own; this shows the session in progress (its ID, its step, the observation window) and
// lets the researchers add what only people see — age, the answers to Q1–Q6, a spontaneous remark, exclusions —
// to any recent session. A session's condition stays covered until its Q2 is marked done (an earlier look is logged).
import { useEffect, useRef, useState } from "react";
import { useLive, send, fetchSessions, downloadCsv, syncSheet, researchKey, setResearchKey, type Live, type Session } from "./api";

const STEP_NAME: Record<string, string> = {
  idle: "대기", photo: "사진", match: "인식", dance: "동작", ladle: "마법 국자", reveal: "캐릭터 등장",
  animation: "영상 재생", observe: "관찰 시간", observed: "관찰 끝", walk: "월드로 출발", done: "완료",
};
const FLAGS: [string, string][] = [
  ["technical_error", "기술적 오류"], ["animation_interrupted", "영상이 중간에 끊김"], ["researcher_interruption", "연구자 개입"],
  ["parent_interruption", "보호자 개입"], ["child_did_not_watch", "아이가 영상을 보지 않음"],
];
const OBSERVE_S = 6, CLIP_S = 5.6;
type Form = { age: string; q1: string; q2: string; q36: string; observed: boolean | null; text: string; flags: Record<string, boolean>; note: string; q2Done: boolean };
const formOf = (s?: Session): Form => ({
  age: s?.age != null ? String(s.age) : "", q1: s?.q1_answer ?? "", q2: s?.q2_answer ?? "", q36: s?.q3_6_answers ?? "",
  observed: s?.spontaneous_verbalization ?? null, text: s?.spontaneous_verbalization_text ?? "", flags: { ...(s?.flags ?? {}) }, note: s?.researcher_note ?? "", q2Done: !!s?.q2_done,
});

export function Console() {
  const [, setKey] = useState(researchKey());
  const { live, err, skew, sheet } = useLive(1000);
  const [sheetMsg, setSheetMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<Session[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // a session chosen by hand (else: the live one, or the latest)
  const [showCond, setShowCond] = useState(false);
  useEffect(() => { document.title = "연구자 콘솔 — Veggie Creature"; document.body.classList.add("research-console"); return () => document.body.classList.remove("research-console"); }, []);
  const load = () => fetchSessions().then((r) => { setRows(r); setListErr(null); }).catch((e) => setListErr(String(e?.message ?? e)));
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);
  useEffect(() => { load(); }, [live?.pid, live?.stage]);

  const needKey = err === "research_key_wrong" || err === "research_not_configured";
  if (needKey) return <KeyGate error={err} onKey={(k) => { setResearchKey(k); setKey(k); location.reload(); }} />;
  const sorted = (rows ?? []).slice().sort((a, b) => String(b.times?.session_start_time ?? "").localeCompare(String(a.times?.session_start_time ?? "")));
  const selectedId = picked ?? live?.pid ?? sorted[0]?.participant_id ?? null;
  const selected = sorted.find((r) => r.participant_id === selectedId);

  return (
    <div className="rc">
      <header className="rc-head">
        <div><h1>연구자 콘솔</h1><p className="rc-sub">AI Suggestiveness 실험 · 체험 안에서 자동 진행</p></div>
        <div className={`rc-conn ${err ? "bad" : live ? "ok" : ""}`}>{err ? `연결 끊김 (${err})` : live ? "연결됨" : "연결 중…"}</div>
      </header>
      {live && <Now live={live} skew={skew} />}
      {selected ? (
        <SessionForm key={selected.participant_id} s={selected} isLive={selected.participant_id === live?.pid} pinned={!!picked}
          onUnpin={() => setPicked(null)} onSaved={load} />
      ) : (
        <section className="rc-card"><p className="rc-hint">아직 세션이 없어요. 아이가 첫 화면에서 사진을 찍으면 자동으로 시작됩니다.</p></section>
      )}
      <section className="rc-card rc-records">
        <div className="rc-row rc-records-head">
          <h2>기록</h2>
          <span className="rc-hint">{rows ? `세션 ${rows.length} · 완료 ${rows.filter((r) => r.completed).length}` : ""}</span>
          <span className="rc-grow" />
          <label className="rc-hint"><input id="show-cond" type="checkbox" checked={showCond} onChange={(e) => setShowCond(e.target.checked)} /> 조건 표시 (책임연구자)</label>
          <button className="rc-btn" onClick={load}>새로고침</button>
          <button className="rc-btn" onClick={() => downloadCsv().catch((e) => setListErr(String(e)))}>CSV 다운로드</button>
          {sheet && (
            <button className="rc-btn" disabled={sheetMsg === "보내는 중…"} onClick={() => {
              setSheetMsg("보내는 중…");
              syncSheet().then((r) => setSheetMsg(r.ok ? `구글 시트에 ${r.total ?? r.n}건 맞춰 놓았어요` : `구글 시트로 못 보냈어요 (${r.error})`)).catch((e) => setSheetMsg(`구글 시트로 못 보냈어요 (${e})`));
            }}>구글 시트로 다시 보내기</button>
          )}
        </div>
        {sheet ? <p className="rc-hint">{sheetMsg ?? "끝난 세션과 콘솔에 적은 내용은 구글 시트에도 자동으로 들어갑니다."}</p> : null}
        {listErr && <p className="rc-warn">{listErr}</p>}
        <div className="rc-table">
          <table>
            <thead><tr><th>ID</th><th>시작</th><th>진행</th><th>나이</th><th>Q2</th>{showCond && <th>조건</th>}{showCond && <th>영상</th>}</tr></thead>
            <tbody>
              {sorted.slice(0, 40).map((r) => (
                <tr key={r.participant_id} className={r.participant_id === selectedId ? "sel" : ""} onClick={() => setPicked(r.participant_id)} style={{ cursor: "pointer" }}>
                  <td>{r.participant_id}{r.offline ? " (오프라인)" : ""}</td>
                  <td>{r.times?.session_start_time ? new Date(r.times.session_start_time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""}</td>
                  <td>{r.completed ? "완료" : r.end_reason ? `중단 (${r.end_reason})` : STEP_NAME[r.stage_reached] ?? r.stage_reached}</td>
                  <td>{r.age ?? "–"}</td><td>{r.q2_done ? "✓" : ""}</td>
                  {showCond && <td>{r.condition}</td>}{showCond && <td><code>{r.animation_id}</code></td>}
                </tr>
              ))}
              {rows && !rows.length && <tr><td colSpan={7} className="rc-hint">아직 세션이 없어요</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// the session in progress: its ID and step; during the clip and the observation window, what to (not) do
function Now({ live, skew }: { live: Live; skew: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(t); }, []);
  if (!live.pid) return <section className="rc-card rc-now idle"><p className="rc-hint">대기 중 — 다음 아이가 첫 화면에서 사진을 찍으면 자동으로 시작돼요.</p></section>;
  const server = now + skew, since = (k: string) => (live.times[k] ? (server - Date.parse(live.times[k])) / 1000 : null);
  const obs = since("animation_end_time"), clip = since("animation_start_time");
  return (
    <section className={`rc-card rc-now s-${live.stage}`}>
      <div className="rc-who">
        <span className="rc-label">지금 진행 중</span>
        <div className="rc-pid">{live.pid}</div>
        <span className={`rc-chip s-${live.stage}`}>{STEP_NAME[live.stage] ?? live.stage}</span>
        {since("session_start_time") != null && <span className="rc-time">{fmt(since("session_start_time")!)}</span>}
      </div>
      {(live.stage === "reveal" || live.stage === "animation") && <p className="rc-strong">캐릭터 등장·영상 재생 중 — 아이에게 말을 걸거나 가리키지 마세요.</p>}
      {live.stage === "animation" && clip != null && <Progress value={clip} total={CLIP_S} />}
      {live.stage === "observe" && <>
        <p className="rc-strong">관찰 시간 — 아무 말도 하지 마세요. 아이가 스스로 말하면 아래 기록에 적어 주세요.</p>
        <Progress value={obs} total={OBSERVE_S} countdown />
      </>}
    </section>
  );
}

function SessionForm({ s, isLive, pinned, onUnpin, onSaved }: { s: Session; isLive: boolean; pinned: boolean; onUnpin: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(() => formOf(s));
  const [saved, setSaved] = useState<"" | "saving" | "saved" | "error">("");
  const [peek, setPeek] = useState(false);
  const timer = useRef(0);
  const pid = s.participant_id;
  const save = (next: Form) => {
    setF(next); setSaved("saving"); clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const r = await send("note", { pid, age: next.age === "" ? null : Number(next.age), q1: next.q1, q2: next.q2, q36: next.q36,
        verbal: { observed: next.observed, text: next.text }, flags: next.flags, note: next.note, q2Done: next.q2Done });
      setSaved(r.ok ? "saved" : "error"); if (r.ok) onSaved();
    }, 600);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const showCond = f.q2Done || peek;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => save({ ...f, [k]: v });
  return (
    <section className="rc-card">
      <div className="rc-who">
        <span className="rc-label">{isLive ? "기록 중 (진행 중인 세션)" : "기록 중"}</span>
        <div className="rc-pid">{pid}</div>
        <span className="rc-hint">{s.completed ? "완료" : s.end_reason ? `중단 (${s.end_reason})` : STEP_NAME[s.stage_reached] ?? s.stage_reached}</span>
        <span className="rc-grow" />
        {pinned && <button className="rc-link" onClick={onUnpin}>진행 중인 세션으로</button>}
        <span className={`rc-save ${saved}`}>{saved === "saving" ? "저장 중…" : saved === "saved" ? "저장됨" : saved === "error" ? "저장 실패" : ""}</span>
      </div>
      <div className={`rc-cond ${showCond ? "open" : ""}`}>
        {showCond ? (
          <span>배정: <b>{s.condition}</b> · Pair {s.animation_pair} · <code>{s.animation_id}</code>{peek && !f.q2Done && <em> (Q2 전에 확인함 — 기록됨)</em>}</span>
        ) : (
          <>
            <span>배정: 🔒 가림 — Q2 완료를 체크하면 보여요</span>
            <button className="rc-link" type="button" onClick={async () => { if (confirm("Q2 전에 조건을 보면 기록에 남아요. 볼까요?") && (await send("reveal", { pid })).ok) setPeek(true); }}>지금 보기</button>
          </>
        )}
      </div>
      <div className="rc-grid">
        <label className="rc-field">나이<input id={`age-${pid}`} type="number" min={2} max={18} inputMode="numeric" value={f.age} onChange={(e) => set("age", e.target.value)} /></label>
        <label className="rc-field wide">Q1 · AI 보기 전 (체험 전에 물은 답)<textarea id={`q1-${pid}`} rows={2} value={f.q1} onChange={(e) => set("q1", e.target.value)} /></label>
        <div className="rc-field wide">
          <span>관찰 시간 자발적 발화</span>
          <div className="rc-row" role="radiogroup" aria-label="자발적 발화">
            <button type="button" className={`rc-toggle ${f.observed === false ? "on" : ""}`} onClick={() => set("observed", false)}>없음</button>
            <button type="button" className={`rc-toggle ${f.observed === true ? "on" : ""}`} onClick={() => set("observed", true)}>있음</button>
          </div>
          <textarea id={`v-${pid}`} rows={2} value={f.text} placeholder="아이가 한 말 그대로 (verbatim)" onChange={(e) => save({ ...f, text: e.target.value, observed: e.target.value ? true : f.observed })} />
        </div>
        <label className="rc-field wide">Q2 · AI 본 후<textarea id={`q2-${pid}`} rows={2} value={f.q2} onChange={(e) => set("q2", e.target.value)} /></label>
        <label className="rc-check"><input id={`q2d-${pid}`} type="checkbox" checked={f.q2Done} onChange={(e) => set("q2Done", e.target.checked)} /> Q2 완료 (이제 조건을 봐도 돼요)</label>
        <label className="rc-field wide">Q3–Q6<textarea id={`q36-${pid}`} rows={3} value={f.q36} placeholder={"Q3: …\nQ4: …\nQ5: …\nQ6: …"} onChange={(e) => set("q36", e.target.value)} /></label>
        <div className="rc-field wide">
          <span>예외</span>
          <div className="rc-flags">
            {FLAGS.map(([k, label]) => (
              <label key={k}><input id={`f-${k}-${pid}`} type="checkbox" checked={!!f.flags[k]} onChange={(e) => set("flags", { ...f.flags, [k]: e.target.checked })} /> {label}</label>
            ))}
          </div>
        </div>
        <label className="rc-field wide">메모<textarea id={`note-${pid}`} rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} /></label>
      </div>
    </section>
  );
}

function KeyGate({ error, onKey }: { error: string | null; onKey: (k: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="rc rc-gate">
      <h1>연구자 콘솔</h1>
      <p>{error === "research_not_configured" ? "서버에 연구 키(RESEARCH_KEY)가 아직 설정되지 않았어요. docs/RESEARCH.md를 확인해 주세요." : "연구 키를 입력하세요. 이 기기에 저장됩니다."}</p>
      {error === "research_key_wrong" && <p className="rc-warn">키가 맞지 않아요.</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onKey(v.trim()); }} className="rc-row">
        <input id="rk" type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder="연구 키" autoFocus />
        <button className="rc-btn primary" type="submit">저장</button>
      </form>
    </div>
  );
}

function Progress({ value, total, countdown }: { value: number | null; total: number; countdown?: boolean }) {
  const v = Math.max(0, Math.min(total, value ?? 0));
  return (
    <div className="rc-progress" aria-hidden="true">
      <div style={{ width: `${(v / total) * 100}%` }} />
      <span>{countdown ? (v >= total ? "끝" : `${Math.ceil(total - v)}초`) : `${v.toFixed(1)} / ${total.toFixed(1)}초`}</span>
    </div>
  );
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
