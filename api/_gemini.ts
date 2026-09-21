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

// The event's five main vegetables — the bodies a child can build on, and so
// the only bodies the figure library (public/parts/fig_*.png) has.
export const VARIANT_IDS = ["pumpkin", "corn", "sweetpotato", "tomato", "cabbage"] as const;

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

// Photo of the child's real veggie creation -> which pre-made character it
// is: the MAIN BODY vegetable plus the sticker parts stuck on it (hat, arms,
// legs), so the wall can assemble the very same figure. Accuracy setup:
// gemini-2.5-flash vision, a reason-first JSON answer whose fields are
// ENUM-constrained to the part library, and THREE parallel judgements
// combined by majority vote per field. On any failure the caller falls back
// to a random pick so the show always goes on.
export const HAT_IDS = ["none", "leaves", "acorn", "straw"] as const;
export const LIMB_IDS = ["twig", "cucumber", "carrot"] as const;
export type Parts = { body: string; hat: string; arms: string; legs: string };

const MATCH_PROMPT =
  "A child built a little creature out of a real vegetable plus printed STICKER parts (photo " +
  "attached). The creature is assembled as: a MAIN BODY vegetable (the torso — the biggest " +
  "central piece), one optional HAT sticker on top, two ARM stickers and two LEG stickers. " +
  "Identify each: " +
  "`variant` = the kind of the main body vegetable, one of exactly five: " +
  "pumpkin = a big flattened-round ribbed pumpkin, dull tan-orange or yellowish-brown (a Korean old pumpkin); " +
  "corn = an ear of corn, yellow kernels, maybe with green or pale husk; " +
  "sweetpotato = an elongated tapered root with reddish-purple or brownish-purple skin; " +
  "tomato = a round smooth glossy red fruit with a small green stem; " +
  "cabbage = a big round head of cabbage: pale green (or whitish-green) leaves wrapped tightly in layers, thick " +
  "white leaf veins, a matte waxy surface, no ribs and no stem on top (that would be the pumpkin). " +
  "Pick the closest of the five by shape first, then color. " +
  "`hat` = the hat sticker on top: leaves = a crown or garland of red, orange and yellow autumn " +
  "maple leaves with little acorns; acorn = a big brown dome-shaped cap with a scaly acorn-cup / " +
  "pinecone texture (a few leaves may peek out beside it); straw = a woven yellow straw sun hat " +
  "with a checked ribbon; none = no hat at all. " +
  "`arms` and `legs` = the sticker style of the limbs: twig = brown wooden twigs/branches (arms " +
  "end in twig fingers, legs in round brown feet), cucumber = green bumpy cucumber pieces, " +
  "carrot = orange carrots with green tops. If the two arms (or the two legs) are of different " +
  "styles, answer the style that is more clearly visible. " +
  "Ignore googly eyes, toothpicks, the hands holding it, the table and other decorations. " +
  "First describe what you see briefly in `reason`, then fill every field. " +
  "IMPORTANT: if NO vegetable creation is visible at all — an empty scene, only a person or " +
  "face with nothing held up, or the creation is too far away or fully hidden — answer " +
  '`variant` "none" instead of guessing.';

type Vote = { variant: string; hat: string; arms: string; legs: string };

async function matchOnce(img: { mimeType: string; data: string }): Promise<Vote | null> {
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
        // a classification, not a puzzle: no thinking budget keeps the answer
        // in a few seconds (with thinking on, the multi-field schema ran ~40s)
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            reason: { type: "STRING" },
            variant: { type: "STRING", enum: [...VARIANT_IDS, "none"] },
            hat: { type: "STRING", enum: [...HAT_IDS] },
            arms: { type: "STRING", enum: [...LIMB_IDS] },
            legs: { type: "STRING", enum: [...LIMB_IDS] },
          },
          required: ["reason", "variant", "hat", "arms", "legs"],
        },
      },
    }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as any;
  try {
    const p = JSON.parse(j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
    if (!(p.variant === "none" || VARIANT_IDS.includes(p.variant))) return null;
    const pick = (v: unknown, ids: readonly string[]) => (typeof v === "string" && ids.includes(v) ? v : ids[0]);
    return { variant: p.variant, hat: pick(p.hat, HAT_IDS), arms: pick(p.arms, LIMB_IDS), legs: pick(p.legs, LIMB_IDS) };
  } catch {
    return null;
  }
}

const majority = (xs: string[]) => {
  const tally = new Map<string, number>();
  for (const x of xs) tally.set(x, (tally.get(x) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const randomParts = (body: string): Parts => ({
  body,
  hat: HAT_IDS[Math.floor(Math.random() * HAT_IDS.length)],
  arms: LIMB_IDS[Math.floor(Math.random() * LIMB_IDS.length)],
  legs: LIMB_IDS[Math.floor(Math.random() * LIMB_IDS.length)],
});

export async function matchVariant(image: string): Promise<Result> {
  const fallback = VARIANT_IDS[Math.floor(Math.random() * VARIANT_IDS.length)];
  if (!key()) return { status: 200, body: { variant: fallback, parts: randomParts(fallback), reason: "no_key" } };
  const img = parseDataUrl(image);
  if (!img) return { status: 400, body: { error: "bad_image" } };
  try {
    const votes = (await Promise.all([matchOnce(img), matchOnce(img), matchOnce(img)]))
      .filter((v): v is Vote => !!v);
    if (!votes.length) return { status: 200, body: { variant: fallback, parts: randomParts(fallback), reason: "no_votes" } };
    const real = votes.filter((v) => v.variant !== "none");
    const best = majority(real.map((v) => v.variant));
    // the sticker parts: majority per field among the votes that saw a creation
    const parts: Parts | null = best
      ? { body: best, hat: majority(real.map((v) => v.hat))!, arms: majority(real.map((v) => v.arms))!, legs: majority(real.map((v) => v.legs))! }
      : null;
    // a "none" majority means no creation was visible — let the kiosk ask the
    // child to hold it closer, with `best` as a last-resort guess
    if (votes.length - real.length >= 2) {
      return { status: 200, body: { variant: null, none: true, best, parts, votes: votes.map((v) => v.variant) } };
    }
    if (!best || !parts) return { status: 200, body: { variant: fallback, parts: randomParts(fallback), reason: "no_votes" } };
    return { status: 200, body: { variant: best, parts, matched: real.length === votes.length, votes: votes.map((v) => v.variant) } };
  } catch (e: any) {
    return { status: 200, body: { variant: fallback, parts: randomParts(fallback), reason: "server_error", detail: String(e?.message || e) } };
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
