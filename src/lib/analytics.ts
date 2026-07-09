// Event tracking (consented at profile creation).
// Every event is (1) appended to a device-local log in localStorage — exportable
// from the staff panel — and (2) POSTed to /api/track (dev: .data/events.jsonl,
// Vercel: function logs; swap in KV/DB for durable cloud storage later).
import { getProfile } from "./profile";

const KEY = "mk.events.v1";

function sessionId(): string {
  let s = sessionStorage.getItem("mk.sid");
  if (!s) {
    s = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem("mk.sid", s);
  }
  return s;
}

export function track(event: string, data: Record<string, unknown> = {}) {
  const e = {
    event,
    ...data,
    profileId: getProfile()?.id ?? null,
    sid: sessionId(),
    t: Date.now(),
  };
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    arr.push(e);
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch {
    /* storage full — server copy still goes out */
  }
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(e),
  }).catch(() => {});
}

export function allEvents(): Record<string, unknown>[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

// Simple per-event-name counts for the staff dashboard.
export function eventCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of allEvents()) {
    const k = String((e as { event?: string }).event ?? "?");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
