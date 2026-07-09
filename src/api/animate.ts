// 클레이 이미지 → Veo 영상(컷신). 시작(/api/animate) 후 완료까지 폴링(/api/animate-status).
// 영상은 1~2분 걸리므로 onTick으로 경과 초를 알려주고, cancel.cancelled로 중단할 수 있다.
export type AnimateResult = {
  video: string | null; // mp4 data URL
  reason?: "no_key" | "cancelled" | "timeout";
  error?: string;
};

export async function animateMonster(
  image: string,
  onTick?: (sec: number) => void,
  cancel?: { cancelled: boolean }
): Promise<AnimateResult> {
  const start = await postJson("/api/animate", { image });
  if (!start.operation) {
    return { video: null, reason: start.reason, error: start.error };
  }
  const op = start.operation as string;
  const t0 = Date.now();

  while (Date.now() - t0 < 180_000) {
    if (cancel?.cancelled) return { video: null, reason: "cancelled" };
    await wait(5000);
    onTick?.(Math.round((Date.now() - t0) / 1000));
    const st = await postJson("/api/animate-status", { operation: op });
    if (st.error) return { video: null, error: st.error };
    if (st.done) return { video: (st.video as string) ?? null };
  }
  return { video: null, reason: "timeout" };
}

import { getProfile } from "../lib/profile";

async function postJson(url: string, body: unknown): Promise<any> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mk-profile": getProfile()?.id ?? "",
      },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    return { error: String(e) };
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
