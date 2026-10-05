// The field survey (public/survey.html, at /survey): the researchers' tablets record each child's answers, the
// observation and the parent's questionnaire — no claude.ai sign-in, the research key once per tablet (the same
// RESEARCH_KEY as the console). One record per participant, kept in research_state as "survey/<id>" (no extra
// table); the newest edit wins (its updatedAt), so a tablet that comes back online late can't undo a later one.
// Each saved record is copied to the researchers' Google Sheet, tab "현장 설문" (api/_researchsheet.ts).
import type { Store } from "./_researchcore.js";
import { postSheet, sheetUrl, kst, cell, type SheetReply } from "./_researchsheet.js";
import type { Out, Defer } from "./_researchstore.js";

export type SurveyRecord = Record<string, any> & { id: string; updatedAt?: string };
const PREFIX = "survey/";
export const SURVEY_TAB = "현장 설문";
const ID = /^[\w-]{1,80}$/;

// the sheet's columns — the page's CSV export (public/survey.html COLS), times in Korea time, + row_version
const CODES = ["persistence", "elaboration", "integration", "fixation", "divergence", "uptake"];
const PQ = ["p1", "p2", "p3", "p4", "p5", "p6"];
const bit = (v: unknown) => (v ? 1 : 0);
const COLS: [string, (r: SurveyRecord) => unknown][] = [
  ["record_id", (r) => r.id], ["participant_id", (r) => r.pid], ["device", (r) => r.device], ["researcher", (r) => r.researcher], ["status", (r) => r.status], ["excluded", (r) => bit(r.excluded)],
  ["created_at", (r) => kst(r.createdAt)], ["completed_at", (r) => kst(r.completedAt)], ["updated_at", (r) => kst(r.updatedAt)],
  ["condition", (r) => r.cond], ["animation", (r) => r.anim],
  ["q1_pre_text", (r) => r.q1?.text], ["q1_followup_used", (r) => bit(r.q1?.follow)], ["q1_no_response", (r) => bit(r.q1?.nr)], ["q1_started_at", (r) => kst(r.q1?.at)],
  ["q2_speech", (r) => r.q2?.speech], ["q2_speech_text", (r) => r.q2?.speechText], ["q2_action", (r) => r.q2?.action], ["q2_action_text", (r) => r.q2?.actionText], ["q2_ai_reaction", (r) => r.q2?.ai], ["q2_ai_reaction_text", (r) => r.q2?.aiText],
  ["q3_post_text", (r) => r.q3?.text], ["q3_followup_used", (r) => bit(r.q3?.follow)], ["q3_no_response", (r) => bit(r.q3?.nr)], ["q3_started_at", (r) => kst(r.q3?.at)],
  ...CODES.map((k): [string, (r: SurveyRecord) => unknown] => [`code_${k}`, (r) => bit(r.code?.[k])]),
  ["ownership", (r) => r.own], ["ownership_score", (r) => ({ no: 1, some: 2, very: 3 } as Record<string, number>)[r.own]],
  ["authorship", (r) => r.auth], ["enjoyment", (r) => r.enjoy], ["again", (r) => r.again], ["again_score", (r) => ({ no: 1, maybe: 2, yes: 3 } as Record<string, number>)[r.again]],
  ...PQ.map((k): [string, (r: SurveyRecord) => unknown] => [`parent_${k}`, (r) => r.parent?.[k]]),
  ["child_age", (r) => r.parent?.age], ["parent_child_gender", (r) => r.parent?.gender], ["parent_creative_pref", (r) => r.parent?.pref], ["parent_digital_use", (r) => r.parent?.digital], ["parent_done_at", (r) => kst(r.parent?.doneAt)],
  ["notes", (r) => r.notes],
  ["row_version", (r) => Date.parse(String(r.updatedAt)) || 0],
];
export const SURVEY_COLUMNS = COLS.map(([c]) => c);
export const surveyRow = (r: SurveyRecord) => COLS.map(([, f]) => { try { return cell(f(r)); } catch { return ""; } });
const time = (r: SurveyRecord | undefined) => Date.parse(String(r?.updatedAt)) || 0;

export async function listSurvey(store: Store): Promise<SurveyRecord[]> {
  return (await store.listState<SurveyRecord>(PREFIX)).map((x) => x.data).sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
}
export async function putSurvey(store: Store, rec: unknown): Promise<{ ok: boolean; stale?: boolean; error?: string }> {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return { ok: false, error: "bad_record" };
  const r = { ...(rec as SurveyRecord) };
  delete r._local;
  if (typeof r.id !== "string" || !ID.test(r.id)) return { ok: false, error: "bad_record_id" };
  if (JSON.stringify(r).length > 64_000) return { ok: false, error: "record_too_large" };
  for (let tries = 0; tries < 8; tries++) {
    const cur = await store.readState<SurveyRecord>(PREFIX + r.id);
    if (cur && time(cur.data) > time(r)) return { ok: true, stale: true }; // (a later edit is already here)
    if (await store.writeState(PREFIX + r.id, r, cur?.rev ?? null)) return { ok: true };
  }
  throw new Error("survey_busy");
}
export function surveyToSheet(records: SurveyRecord[], timeoutMs?: number): Promise<SheetReply> {
  return postSheet({ table: { name: SURVEY_TAB, id: "record_id", columns: SURVEY_COLUMNS, rows: records.map(surveyRow) } }, undefined, timeoutMs);
}

// GET ?survey -> { records, sheet }; POST surveyPut { record } | surveySheet (every record to the sheet again).
// The caller has checked the research key. null = not a survey request.
export async function surveyRequest(store: Store, method: string, query: Record<string, unknown>, body: any, defer: Defer): Promise<Out | null> {
  if (method === "GET" && "survey" in query) return { status: 200, body: { records: await listSurvey(store), sheet: !!sheetUrl(), now: Date.now() } };
  if (method !== "POST") return null;
  if (body?.op === "surveyPut") {
    const r = await putSurvey(store, body.record);
    if (r.ok && !r.stale && sheetUrl()) {
      const id = String(body.record.id);
      defer((async () => {
        const cur = await store.readState<SurveyRecord>(PREFIX + id);
        const s = cur ? await surveyToSheet([cur.data]) : { ok: true };
        if (!s.ok) console.warn("[survey] sheet:", s.error, id);
      })().catch((e) => console.warn("[survey] sheet:", e)));
    }
    return { status: r.ok ? 200 : 400, body: r };
  }
  if (body?.op === "surveySheet") {
    if (!sheetUrl()) return { status: 409, body: { ok: false, error: "sheet_not_configured" } };
    const all = await listSurvey(store);
    let n = 0, url: string | undefined;
    for (let i = 0; i < all.length || i === 0; i += 250) { // (none yet: one empty send still makes the tab)
      const r = await surveyToSheet(all.slice(i, i + 250), 40_000);
      if (!r.ok) return { status: 502, body: { ok: false, error: r.error, n } };
      n += r.n ?? 0; url = r.url ?? url;
    }
    return { status: 200, body: { ok: true, n, total: all.length, url } };
  }
  return null;
}
