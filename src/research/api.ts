// The researchers' console side of api/research.ts (the kiosk side is lib/experiment.ts).
import { useEffect, useRef, useState } from "react";
import { researchKey } from "../lib/experiment";
export { researchKey, setResearchKey } from "../lib/experiment";

export type Live = { pid: string | null; stage: string; assigned: { condition: "HIGH" | "LOW"; pair: "A" | "B" | "C"; animationId: string } | null; times: Record<string, string> };
export type Session = Record<string, any>;
const headers = () => ({ "Content-Type": "application/json", "x-research-key": researchKey() });

export async function fetchLive(): Promise<{ live: Live; now: number; sheet?: boolean }> {
  const r = await fetch("/api/research", { headers: headers(), cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `http_${r.status}`);
  return j;
}
export async function send(op: string, data: Record<string, unknown> = {}) {
  const r = await fetch("/api/research", { method: "POST", headers: headers(), body: JSON.stringify({ op, by: "console", ...data }) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok !== false, error: j.error as string | undefined };
}
// every session to the researchers' Google Sheet again (api/_researchsheet.ts)
// (in parts — the server sends 250 sessions per request and says where the next part starts)
export async function syncSheet(onProgress?: (done: number, total: number) => void): Promise<{ ok: boolean; total?: number; error?: string }> {
  let offset: number | null = 0, total = 0;
  while (offset !== null) {
    const r: Response = await fetch("/api/research", { method: "POST", headers: headers(), body: JSON.stringify({ op: "sheetSync", by: "console", offset }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) return { ok: false, total: j.total, error: j.error ?? `http_${r.status}` };
    total = j.total ?? total;
    onProgress?.(j.next ?? total, total);
    offset = typeof j.next === "number" ? j.next : null;
  }
  return { ok: true, total };
}
// the newest sessions (the console's table) and how many there are in all
export const RECENT = 80;
export async function fetchSessions(): Promise<{ sessions: Session[]; total: number }> {
  const r = await fetch(`/api/research?sessions&recent=${RECENT}`, { headers: headers(), cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `http_${r.status}`);
  return { sessions: j.sessions ?? [], total: j.total ?? (j.sessions ?? []).length };
}
export async function downloadCsv() {
  const r = await fetch("/api/research?sessions&csv", { headers: headers(), cache: "no-store" });
  if (!r.ok) throw new Error(`http_${r.status}`);
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: `research_sessions_${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

// poll the session in progress; `err` when the server is unreachable or refuses
export function useLive(ms: number) {
  const [live, setLive] = useState<Live | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [skew, setSkew] = useState(0); // server clock − this clock (ms)
  const [sheet, setSheet] = useState(false); // the server copies sessions to the Google Sheet
  const last = useRef("");
  useEffect(() => {
    let stop = false, timer = 0;
    const tick = async () => {
      try {
        const t0 = Date.now(), { live: l, now, sheet: sh } = await fetchLive();
        if (stop) return;
        setSheet(!!sh);
        setSkew(now - (t0 + Date.now()) / 2);
        const k = JSON.stringify(l); if (k !== last.current) { last.current = k; setLive(l); }
        setErr(null);
      } catch (e) { if (!stop) setErr(String((e as Error)?.message ?? e)); }
      if (!stop) timer = window.setTimeout(tick, ms);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [ms]);
  return { live, err, skew, sheet };
}
