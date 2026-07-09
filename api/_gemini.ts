// Shared server-side Gemini logic, used by both the Vite dev proxy (vite.config.ts)
// and the Vercel serverless functions (api/*.ts). The API key is read from the
// environment only — it is never sent to the browser.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

export const CLAY_PROMPT =
  "Turn this photo into an adorable, kid-friendly claymation character — like a lovable creature " +
  "from a children's stop-motion cartoon. Keep the same overall shape, pose, and main colors of " +
  "the subject so it is clearly the same monster, but make it cuter, rounder and chubbier: " +
  "squishy chunky plasticine forms, big soft rounded body, smooth clay surface with tiny gentle " +
  "fingerprint dents, bright cheerful candy-pastel colors, a warm happy friendly expression and a " +
  "tiny smile. Soft even lighting, gentle soft shadows, a simple clean solid pastel background. " +
  "Wholesome, charming, bouncy and toy-like, designed to delight young children aged 5 to 9. " +
  "No scary, creepy or photorealistic details, no extra props, no text, no watermark.";

export const ANIMATE_PROMPT =
  "Animate this clay monster with very subtle, gentle stop-motion motion, looping-friendly. " +
  "It softly breathes (tiny squash and stretch), blinks once, and gently opens and closes its " +
  "mouth as if happily about to speak, then returns to the exact same neutral starting pose so the " +
  "clip can loop seamlessly. Minimal, calm motion only — no big movement, no walking, camera stays " +
  "completely still. Keep the exact same character: same shape, colors and clay texture. " +
  "Wholesome and charming for young children. No text, no watermark.";

const key = () => process.env.GEMINI_API_KEY || "";
const imageModel = () => process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const videoModel = () => process.env.GEMINI_VIDEO_MODEL || "veo-3.1-lite-generate-preview";

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

// Clay image -> start video generation (long-running)
export async function startAnimate(image: string, prompt?: string): Promise<Result> {
  if (!key()) return { status: 200, body: { operation: null, reason: "no_key" } };
  const img = parseDataUrl(image);
  if (!img) return { status: 400, body: { error: "bad_image" } };
  try {
    const r = await fetch(`${GEMINI}/models/${videoModel()}:predictLongRunning`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
      body: JSON.stringify({
        instances: [{ prompt: prompt || ANIMATE_PROMPT, image: { bytesBase64Encoded: img.data, mimeType: img.mimeType } }],
        parameters: { aspectRatio: "16:9" },
      }),
    });
    if (!r.ok) return { status: 502, body: { error: "veo_error", status: r.status, detail: (await r.text()).slice(0, 600) } };
    const j = (await r.json()) as any;
    if (!j?.name) return { status: 502, body: { error: "no_operation", detail: JSON.stringify(j).slice(0, 400) } };
    return { status: 200, body: { operation: j.name } };
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
