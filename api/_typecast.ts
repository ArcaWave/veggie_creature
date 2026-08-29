// Shared server-side Typecast (typecast.ai) text-to-speech logic, used by both the
// Vite dev proxy (vite.config.ts) and the Vercel serverless functions (api/*.ts).
// The API key lives in the environment only — it is never sent to the browser.
//
// Docs: https://typecast.ai/docs/api-reference/text-to-speech/text-to-speech
//  POST https://api.typecast.ai/v1/text-to-speech  (X-API-KEY) -> raw audio bytes
//  GET  https://api.typecast.ai/v2/voices          (X-API-KEY) -> voice catalog
const TYPECAST = "https://api.typecast.ai";

const key = () => process.env.TYPECAST_API_KEY || "";
// Optional pinned voice (normally unset — voices are auto-assigned per character).
const pinnedVoiceId = () => process.env.TYPECAST_VOICE_ID || "";

export type Result = { status: number; body: Record<string, unknown> };

// ---- per-character voice assignment ---------------------------------------
// Each creature gets its OWN voice: the client sends the character name as `seed`,
// which hashes into a kid-friendly pool from the live catalog. Same name -> same
// voice for the whole dialogue; different creature -> different voice.
type Voice = {
  voice_id: string;
  voice_name?: string;
  gender?: string;
  age?: string;
  models?: { version: string; emotions?: string[] }[];
};

let catalog: { at: number; voices: Voice[] } | null = null;
const CATALOG_TTL = 10 * 60_000;

async function loadCatalog(): Promise<Voice[]> {
  if (catalog && Date.now() - catalog.at < CATALOG_TTL) return catalog.voices;
  const r = await fetch(`${TYPECAST}/v2/voices`, { headers: { "X-API-KEY": key() } });
  if (!r.ok) throw new Error(`voices ${r.status}`);
  const j = (await r.json()) as any;
  const voices: Voice[] = Array.isArray(j) ? j : j?.voices ?? [];
  catalog = { at: Date.now(), voices };
  return voices;
}

// Cheerful young voices that can do the "happy" preset make the best creatures.
function kidPool(voices: Voice[]): Voice[] {
  const happy = (v: Voice) => v.models?.some((m) => m.emotions?.includes("happy"));
  const young = voices.filter((v) => (v.age === "child" || v.age === "teenager") && happy(v));
  return young.length ? young : voices.filter(happy).length ? voices.filter(happy) : voices;
}

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
};

async function pickVoice(seed: string): Promise<{ voiceId: string; model: string } | null> {
  const voices = await loadCatalog();
  const pinned = pinnedVoiceId();
  const pool = kidPool(voices);
  const v = pinned ? voices.find((x) => x.voice_id === pinned) ?? pool[hash(seed) % pool.length] : pool[hash(seed) % pool.length];
  if (!v) return null;
  // each voice supports specific model versions — always use the voice's own
  const model = v.models?.[0]?.version || process.env.TYPECAST_MODEL || "ssfm-v21";
  return { voiceId: v.voice_id, model };
}

// English line -> mp3 data URL. Happy preset suits the greeting; mp3 keeps the
// payload ~10x smaller than wav for tablet playback.
export async function speak(text: string, seed?: string): Promise<Result> {
  if (!key()) return { status: 200, body: { audio: null, reason: "no_key" } };
  const line = String(text ?? "").trim().slice(0, 300);
  if (!line) return { status: 400, body: { error: "no_text" } };
  try {
    const picked = await pickVoice(String(seed ?? "creature"));
    if (!picked) return { status: 200, body: { audio: null, reason: "no_voice" } };
    const r = await fetch(`${TYPECAST}/v1/text-to-speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": key() },
      body: JSON.stringify({
        voice_id: picked.voiceId,
        text: line,
        model: picked.model,
        language: "eng",
        prompt: { emotion_type: "preset", emotion_preset: "happy", emotion_intensity: 1.2 },
        output: { audio_format: "mp3" },
      }),
    });
    if (!r.ok) {
      return { status: 502, body: { error: "typecast_error", status: r.status, detail: (await r.text()).slice(0, 600) } };
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: 200, body: { audio: `data:audio/mpeg;base64,${buf.toString("base64")}` } };
  } catch (e: any) {
    return { status: 500, body: { error: "server_error", detail: String(e?.message || e) } };
  }
}

// Voice catalog passthrough — used once during setup to choose TYPECAST_VOICE_ID
// (e.g. `curl localhost:5180/api/voices`). Not called by the play flow.
export async function listVoices(): Promise<Result> {
  if (!key()) return { status: 200, body: { voices: null, reason: "no_key" } };
  try {
    const r = await fetch(`${TYPECAST}/v2/voices`, { headers: { "X-API-KEY": key() } });
    if (!r.ok) {
      return { status: 502, body: { error: "typecast_error", status: r.status, detail: (await r.text()).slice(0, 600) } };
    }
    return { status: 200, body: { voices: await r.json() } };
  } catch (e: any) {
    return { status: 500, body: { error: "server_error", detail: String(e?.message || e) } };
  }
}
