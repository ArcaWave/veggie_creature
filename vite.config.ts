import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { stylize, startAnimate, animateStatus } from "./api/_gemini";
import { checkLimit, limitKey } from "./api/_ratelimit";

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const send = (res: ServerResponse, code: number, obj: unknown) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
};

// Dev-only proxy that mirrors the Vercel serverless functions (api/*.ts) using the
// same shared logic. In production those functions run instead; this is just for `vite dev`.
function devApiPlugin(): Plugin {
  return {
    name: "vegiemonster-dev-api",
    configureServer(server) {
      const route = (p: string, name: string, fn: (body: any) => Promise<{ status: number; body: unknown }>) =>
        server.middlewares.use(p, async (req, res) => {
          if (req.method !== "POST") return send(res, 405, { error: "POST only" });
          const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
          if (!checkLimit(name, key)) return send(res, 429, { error: "rate_limited" });
          try {
            const body = JSON.parse((await readBody(req)) || "{}");
            const { status, body: out } = await fn(body);
            send(res, status, out);
          } catch (e: any) {
            send(res, 500, { error: "server_error", detail: String(e?.message || e) });
          }
        });

      route("/api/stylize", "stylize", (b) => stylize(b.image, b.prompt));
      route("/api/animate", "animate", (b) => startAnimate(b.image, b.prompt));
      route("/api/animate-status", "animate-status", (b) => animateStatus(b.operation));
      // dev analytics sink: append events to .data/events.jsonl
      route("/api/track", "track", async (b) => {
        try {
          const dir = path.join(process.cwd(), ".data");
          fs.mkdirSync(dir, { recursive: true });
          fs.appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify(b) + "\n");
        } catch {
          /* best effort */
        }
        return { status: 200, body: { ok: true } };
      });
      // dev durable-save sink: mirrors api/save.ts into .data/ (prod uses Vercel Blob)
      route("/api/save", "save", async (b) => {
        try {
          const dir = path.join(process.cwd(), ".data");
          fs.mkdirSync(dir, { recursive: true });
          if (b.kind === "profile" && b.profile) {
            fs.appendFileSync(path.join(dir, "profiles.jsonl"), JSON.stringify({ ...b.profile, savedAt: Date.now() }) + "\n");
            return { status: 200, body: { saved: true } };
          }
          if (b.kind === "monster" && b.monster) {
            const m = b.monster;
            const stamp = `${m.profileId ?? "anon"}-${Date.now()}`;
            let imageSaved = false;
            const img = /^data:image\/(\w+);base64,(.*)$/s.exec(m.image || "");
            if (img) {
              fs.mkdirSync(path.join(dir, "monsters"), { recursive: true });
              fs.writeFileSync(path.join(dir, "monsters", `${stamp}.${img[1] === "jpeg" ? "jpg" : img[1]}`), Buffer.from(img[2], "base64"));
              imageSaved = true;
            }
            fs.appendFileSync(
              path.join(dir, "monsters.jsonl"),
              JSON.stringify({ profileId: m.profileId ?? null, name: m.name, traits: m.traits, eyes: m.eyes ?? [], stars: m.stars, imageFile: imageSaved ? `monsters/${stamp}` : null, savedAt: Date.now() }) + "\n"
            );
            return { status: 200, body: { saved: true, imageSaved } };
          }
          if (b.kind === "asset" && b.asset) {
            const a = b.asset;
            const data = typeof a.data === "string" ? a.data : "";
            const m2 = /^data:(\w+)\/(\w+);base64,(.*)$/s.exec(data);
            if (!m2) return { status: 400, body: { error: "bad_data" } };
            const type = String(a.type ?? "asset").replace(/[^a-z0-9-]/gi, "");
            const ext = m2[1] === "video" ? "mp4" : m2[2] === "jpeg" ? "jpg" : m2[2];
            fs.mkdirSync(path.join(dir, "gallery"), { recursive: true });
            fs.writeFileSync(path.join(dir, "gallery", `${a.profileId ?? "anon"}-${type}-${Date.now()}.${ext}`), Buffer.from(m2[3], "base64"));
            return { status: 200, body: { saved: true } };
          }
          return { status: 400, body: { error: "bad_kind" } };
        } catch (e: any) {
          return { status: 500, body: { error: "server_error", detail: String(e?.message || e) } };
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // bridge .env into process.env so the shared lib (which reads process.env) works in dev
  const env = loadEnv(mode, process.cwd(), "");
  process.env.GEMINI_API_KEY = env.GEMINI_API_KEY || "";
  process.env.GEMINI_IMAGE_MODEL = env.GEMINI_IMAGE_MODEL || "";
  process.env.GEMINI_VIDEO_MODEL = env.GEMINI_VIDEO_MODEL || "";

  return {
    plugins: [react(), devApiPlugin()],
    server: { host: true, port: 5180 },
  };
});
