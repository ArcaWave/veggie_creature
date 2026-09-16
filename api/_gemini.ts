// Shared server-side Gemini logic, used by both the Vite dev proxy (vite.config.ts)
// and the Vercel serverless functions (api/*.ts). The API key is read from the
// environment only — it is never sent to the browser.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

// Full-body version: the pose/background constraints double as rig-friendly
// normalisation for the AnimatedDrawings engine (arms out, legs visible, clean
// white background — see animator/rig.py).
export const CLAY_PROMPT =
  "Turn this photo into an adorable, kid-friendly claymation character for a children's " +
  "stop-motion cartoon, drawn as a FULL BODY standing character. Keep the same overall shape and " +
  "main colors of the subject as the character's head and torso so it is clearly the same " +
  "creature, but give it a complete body: two visible chubby clay ARMS held slightly out to the " +
  "sides away from the body, and two visible short clay LEGS with feet, standing upright facing " +
  "the camera in a neutral A-pose. The whole character must be fully inside the frame with margin " +
  "around it, limbs clearly separated from the body (no arms touching the torso), squishy chunky " +
  "plasticine forms, smooth clay surface, bright cheerful candy-pastel colors, a warm happy " +
  "friendly expression with a tiny smile. CRITICAL: plain solid WHITE background, no floor shadow, " +
  "no props, no text, no watermark. Soft even lighting. Wholesome, charming and toy-like, designed " +
  "to delight young children aged 5 to 9. No scary, creepy or photorealistic details.";

export const ANIMATE_PROMPT =
  "Animate this clay monster with very subtle, gentle stop-motion motion, looping-friendly. " +
  "It softly breathes (tiny squash and stretch), blinks once, and gently opens and closes its " +
  "mouth as if happily about to speak, then returns to the exact same neutral starting pose so the " +
  "clip can loop seamlessly. Minimal, calm motion only — no big movement, no walking, camera stays " +
  "completely still. Keep the exact same character: same shape, colors and clay texture. " +
  "Wholesome and charming for young children. No text, no watermark.";

// Two dedicated loops for the greeting experience (generated together, one per clip).
// GREET plays first, on repeat, while the child is invited to wave back at the tablet.
export const GREET_PROMPT =
  "Animate this clay monster warmly waving hello, looping-friendly. It raises one little clay " +
  "arm and gives a friendly hello wave two or three times, with a big happy welcoming smile and " +
  "bright cheerful eyes, gently bouncing, then returns to the exact same neutral starting pose so " +
  "the clip can loop seamlessly. Gentle stop-motion motion, tiny squash and stretch, camera stays " +
  "completely still. Keep the exact same character: same shape, colors and clay texture. " +
  "Wholesome and charming for young children. No text, no watermark.";

// SMILE plays after the child waves back — the monster beams and "talks" while captions/voice run.
export const SMILE_PROMPT =
  "Animate this clay monster smiling and happily talking, looping-friendly. It beams a big warm " +
  "friendly smile with sparkling happy eyes and gently opens and closes its mouth as if cheerfully " +
  "chatting and saying kind words, with tiny happy head bobs, then returns to the exact same " +
  "neutral starting pose so the clip can loop seamlessly. Gentle stop-motion motion, tiny squash " +
  "and stretch, camera stays completely still. Keep the exact same character: same shape, colors " +
  "and clay texture. Wholesome and charming for young children. No text, no watermark.";

const key = () => process.env.GEMINI_API_KEY || "";
const imageModel = () => process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const videoModel = () => process.env.GEMINI_VIDEO_MODEL || "veo-3.1-lite-generate-preview";
const matchModel = () => process.env.GEMINI_MATCH_MODEL || "gemini-2.5-flash";

// The pre-generated creature library (tools/pregen_variants.py + public/variants).
export const VARIANT_IDS = [
  "carrot", "broccoli", "tomato", "potato", "cucumber", "eggplant", "corn", "cauliflower",
] as const;

export type Result = { status: number; body: Record<string, unknown> };

function parseDataUrl(image: string) {
  const m = /^data:(.+?);base64,(.*)$/s.exec(image || "");
  return m ? { mimeType: m[1], data: m[2] } : null;
}

// Photo -> clay image
export async function stylize(image: string, prompt?: string): Promise<Result> {
  if (!key()) return { status: 200, body: { stylized: null, reason: "no_key" } };
  const img = parseDataUrl(image);
  if (!img) return { status: 400, body: { error: "bad_image" } };
  try {
    const r = await fetch(`${GEMINI}/models/${imageModel()}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt || CLAY_PROMPT }, { inline_data: { mime_type: img.mimeType, data: img.data } }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });
    if (!r.ok) return { status: 502, body: { error: "gemini_error", status: r.status, detail: (await r.text()).slice(0, 600) } };
    const j = (await r.json()) as any;
    const part = (j?.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData || p.inline_data);
    const inline = part?.inlineData || part?.inline_data;
    if (!inline?.data) return { status: 200, body: { stylized: null, reason: "no_image_returned" } };
    return { status: 200, body: { stylized: `data:${inline.mimeType || inline.mime_type || "image/png"};base64,${inline.data}` } };
  } catch (e: any) {
    return { status: 500, body: { error: "server_error", detail: String(e?.message || e) } };
  }
}

// Photo of the child's real veggie creation -> which pre-made variant character
// resembles it most. Accuracy setup: gemini-2.5-flash vision, a reason-first
// JSON answer whose `variant` field is ENUM-constrained to the library, and
// THREE parallel judgements combined by majority vote. On any failure the
// caller falls back to a random variant so the show always goes on.
const MATCH_PROMPT =
  "A child built a little creature out of real vegetables (photo attached). " +
  "The creature is assembled as: a hat/head piece, a MAIN BODY vegetable (the torso — the " +
  "biggest central piece), and small arms/legs. Identify the MAIN BODY vegetable only — its " +
  "kind and color. Ignore hats, googly eyes, toothpicks, arms, legs, hands holding it, the " +
  "table and other decorations. First describe the main body briefly in `reason`, then pick " +
  "the closest matching character type in `variant`. " +
  "IMPORTANT: if NO vegetable creation is visible at all — an empty scene, only a person or " +
  "face with nothing held up, or the creation is too far away or fully hidden — answer " +
  '`variant` "none" instead of guessing.';

async function matchOnce(img: { mimeType: string; data: string }): Promise<string | null> {
  const r = await fetch(`${GEMINI}/models/${matchModel()}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: MATCH_PROMPT },
          { inline_data: { mime_type: img.mimeType, data: img.data } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            reason: { type: "STRING" },
            variant: { type: "STRING", enum: [...VARIANT_IDS, "none"] },
          },
          required: ["reason", "variant"],
        },
      },
    }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as any;
  try {
    const parsed = JSON.parse(j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
    return parsed.variant === "none" || VARIANT_IDS.includes(parsed.variant) ? parsed.variant : null;
  } catch {
    return null;
  }
}

export async function matchVariant(image: string): Promise<Result> {
  const fallback = VARIANT_IDS[Math.floor(Math.random() * VARIANT_IDS.length)];
  if (!key()) return { status: 200, body: { variant: fallback, reason: "no_key" } };
  const img = parseDataUrl(image);
  if (!img) return { status: 400, body: { error: "bad_image" } };
  try {
    const votes = (await Promise.all([matchOnce(img), matchOnce(img), matchOnce(img)]))
      .filter((v): v is string => !!v);
    if (!votes.length) return { status: 200, body: { variant: fallback, reason: "no_votes" } };
    const real = votes.filter((v) => v !== "none");
    const tally = new Map<string, number>();
    for (const v of real) tally.set(v, (tally.get(v) ?? 0) + 1);
    const best = real.length ? [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
    // a "none" majority means no creation was visible — let the kiosk ask the
    // child to hold it closer, with `best` as a last-resort guess
    if (votes.length - real.length >= 2) {
      return { status: 200, body: { variant: null, none: true, best, votes } };
    }
    if (!best) return { status: 200, body: { variant: fallback, reason: "no_votes" } };
    return { status: 200, body: { variant: best, matched: real.length === votes.length, votes } };
  } catch (e: any) {
    return { status: 200, body: { variant: fallback, reason: "server_error", detail: String(e?.message || e) } };
  }
}

// Clay image -> start video generation (long-running).
// QUOTA FALLBACK CHAIN: each Veo model has its own quota bucket, so when the
// primary model returns 429 (rate/daily limit) we automatically try the next
// one. Costs rise down the chain (lite ≈ $0.03-0.05/s → fast ≈ $0.10-0.15/s →
// quality ≈ $0.20-0.40/s) — remove "veo-3.1-generate-preview" below to cap
// spend at fast. Non-429 errors are real failures and do NOT fall through.
const VIDEO_FALLBACKS = ["veo-3.1-fast-generate-preview", "veo-3.1-generate-preview"];

// Resolve which motion prompt to use. An explicit `prompt` always wins; otherwise
// `kind` selects a named loop ("greet"/"smile"), falling back to the calm breathe loop.
function resolvePrompt(prompt?: string, kind?: string): string {
  if (prompt) return prompt;
  if (kind === "greet") return GREET_PROMPT;
  if (kind === "smile") return SMILE_PROMPT;
  return ANIMATE_PROMPT;
}

export async function startAnimate(image: string, prompt?: string, kind?: string): Promise<Result> {
  if (!key()) return { status: 200, body: { operation: null, reason: "no_key" } };
  const img = parseDataUrl(image);
  if (!img) return { status: 400, body: { error: "bad_image" } };
  const motion = resolvePrompt(prompt, kind);
  const chain = [...new Set([videoModel(), ...VIDEO_FALLBACKS])];
  try {
    let last: { status: number; detail: string } = { status: 0, detail: "" };
    for (const model of chain) {
      const r = await fetch(`${GEMINI}/models/${model}:predictLongRunning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
        body: JSON.stringify({
          instances: [{ prompt: motion, image: { bytesBase64Encoded: img.data, mimeType: img.mimeType } }],
          parameters: { aspectRatio: "16:9" },
        }),
      });
      if (r.ok) {
        const j = (await r.json()) as any;
        if (!j?.name) return { status: 502, body: { error: "no_operation", detail: JSON.stringify(j).slice(0, 400) } };
        console.log(`[veo] started on ${model}`);
        return { status: 200, body: { operation: j.name, model } };
      }
      last = { status: r.status, detail: (await r.text()).slice(0, 600) };
      if (r.status !== 429) break; // real error — don't burn the fallbacks
      console.log(`[veo] ${model} quota-exhausted (429), trying next model`);
    }
    return { status: 502, body: { error: "veo_error", status: last.status, detail: last.detail } };
  } catch (e: any) {
    return { status: 500, body: { error: "server_error", detail: String(e?.message || e) } };
  }
}

// Poll the video operation; when done, download the mp4 and return it as a data URL
export async function animateStatus(operation: string): Promise<Result> {
  if (!operation) return { status: 400, body: { error: "no_operation" } };
  try {
    const r = await fetch(`${GEMINI}/${operation}`, { headers: { "x-goog-api-key": key() } });
    if (!r.ok) return { status: 502, body: { error: "poll_error", status: r.status, detail: (await r.text()).slice(0, 400) } };
    const j = (await r.json()) as any;
    if (!j.done) return { status: 200, body: { done: false } };
    const uri = j?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) return { status: 200, body: { done: true, video: null, detail: JSON.stringify(j).slice(0, 400) } };
    const vr = await fetch(uri, { headers: { "x-goog-api-key": key() } });
    if (!vr.ok) return { status: 502, body: { error: "download_error", status: vr.status } };
    const buf = Buffer.from(await vr.arrayBuffer());
    return { status: 200, body: { done: true, video: `data:video/mp4;base64,${buf.toString("base64")}` } };
  } catch (e: any) {
    return { status: 500, body: { error: "server_error", detail: String(e?.message || e) } };
  }
}
