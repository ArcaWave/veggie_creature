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
