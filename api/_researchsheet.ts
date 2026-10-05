// A copy of the sessions in the researchers' own Google Sheet (docs/RESEARCH.md "구글 시트"). The sheet runs a small
// Apps Script (tools/research-sheet.gs) published as a web app; its address is RESEARCH_SHEET_URL (Vercel env, never
// in the code). Supabase stays the record: the sheet is a mirror, written after the answer has gone out, and the
// console's "시트로 전체 다시 보내기" sends every session again if the sheet ever missed one.
// One row per participant_id, the CSV's columns, times in Korea time (KST). row_version counts the session's events
// (every change adds one), so a late copy never overwrites a newer one. Columns the researchers add are kept.
import { CSV_COLUMNS, flat, type Session } from "./_researchcore.js";

export const SHEET_COLUMNS = [...CSV_COLUMNS, "row_version"];
const TIME = /_time$/;
export const kst = (v: unknown) => {
  const t = Date.parse(String(v));
  if (!v || !Number.isFinite(t)) return "";
  return new Date(t + 9 * 3600_000).toISOString().replace("T", " ").replace("Z", ""); // 2026-10-04 14:23:05.123
};
// (a typed answer that begins like a formula stays text: the leading ' marks text in Sheets and isn't shown)
export const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v);
export function sheetRow(s: Session): unknown[] {
  const r = flat(s);
  return SHEET_COLUMNS.map((c) => cell(c === "row_version" ? s.events?.length ?? 0 : TIME.test(c) ? kst(r[c]) : r[c]));
}

export const sheetUrl = () => (process.env.RESEARCH_SHEET_URL || "").trim() || null;
export type SheetReply = { ok: boolean; n?: number; error?: string; url?: string };
// one POST to the web app: the sessions as { columns, rows } (the "sessions" tab), any other table as
// { table: { name, id, columns, rows, blind? } } — a shape an older script refuses rather than writing into "sessions"
export async function postSheet(payload: unknown, url = sheetUrl(), timeoutMs = 20_000): Promise<SheetReply> {
  if (!url) return { ok: false, error: "sheet_not_configured" };
  try {
    // (Apps Script answers a POST with a redirect to its result; fetch follows it)
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(payload) });
    const text = await r.text();
    let j: SheetReply = { ok: false };
    try { j = JSON.parse(text); } catch { return { ok: false, error: `sheet_not_json_${r.status}` }; } // (a sign-in page: the web app isn't open to "Anyone")
    return j.ok ? { ok: true, n: j.n, url: j.url } : { ok: false, error: j.error ?? `sheet_http_${r.status}` };
  } catch (e: any) {
    return { ok: false, error: `sheet_${e?.name === "TimeoutError" ? "timeout" : "unreachable"}` };
  }
}
export async function toSheet(rows: Session[], url = sheetUrl(), timeoutMs = 20_000): Promise<SheetReply> {
  if (!url) return { ok: false, error: "sheet_not_configured" };
  if (!rows.length) return { ok: true, n: 0 };
  const r = await postSheet({ columns: SHEET_COLUMNS, rows: rows.map(sheetRow) }, url, timeoutMs);
  return r.ok ? { ...r, n: r.n ?? rows.length } : r;
}
