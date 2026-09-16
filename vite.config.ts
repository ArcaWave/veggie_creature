import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { stylize, startAnimate, animateStatus, matchVariant } from "./api/_gemini";
import { speak, listVoices } from "./api/_typecast";
import { sendKeepsakes } from "./api/_email";
import { listCreatures, uploadCreature } from "./api/_creaturestore";
import { checkLimit, limitKey } from "./api/_ratelimit";

const ANIMATOR = () => process.env.ANIMATOR_URL || "http://127.0.0.1:8765";

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

      // dev-only: a page can drop a JPEG/PNG data URL into the scratch dir for
      // visual review (used while tuning the 3D village rigs); never deployed
      server.middlewares.use("/api/_shot", async (req, res) => {
        if (req.method !== "POST") return send(res, 405, { error: "POST only" });
        try {
          const b = JSON.parse((await readBody(req)) || "{}");
          const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(String(b.image || ""));
          const name = String(b.name || "shot").replace(/[^\w-]/g, "");
          const dir = process.env.VC_SHOT_DIR || `${process.cwd()}/.shots`;
          if (!m) return send(res, 400, { error: "bad" });
          fs.mkdirSync(dir, { recursive: true });
          const file = `${dir}/${name}.${m[1] === "png" ? "png" : "jpg"}`;
          fs.writeFileSync(file, Buffer.from(m[2], "base64"));
          send(res, 200, { ok: true, file });
        } catch (e: any) { send(res, 500, { error: String(e?.message || e) }); }
      });

      route("/api/stylize", "stylize", (b) => stylize(b.image, b.prompt));
      route("/api/animate", "animate", (b) => startAnimate(b.image, b.prompt, b.kind));
      route("/api/animate-status", "animate-status", (b) => animateStatus(b.operation));
      // main engine: the local AnimatedDrawings render server (zero-cost clips).
      // Reuses the "animate" rate-limit bucket; unreachable server -> soft error
      // so the client can fall back instead of blowing up.
      route("/api/animate-drawings", "animate", async (b) => {
        try {
          const r = await fetch(`${ANIMATOR()}/animate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: b.image }),
          });
          return { status: r.status, body: await r.json() };
        } catch (e: any) {
          return { status: 200, body: { error: "no_server", detail: String(e?.message || e) } };
        }
      });
      route("/api/match", "stylize", (b) => matchVariant(b.image));
      // creature relay (scan PC -> Blob -> display PC). Only tiny {variant}
      // records travel — the clips are pre-made static files. Without a Blob
      // token in dev, an in-memory list keeps the one-machine demo working.
      const devCreatures: { id: string; variant: string; at: number }[] = [];
      server.middlewares.use("/api/creatures", async (req, res) => {
        if (req.method === "POST") {
          const key = limitKey(req.headers["x-mk-profile"], req.headers["x-forwarded-for"], req.socket?.remoteAddress);
          if (!checkLimit("save", key)) return send(res, 429, { error: "rate_limited" });
          try {
            const b = JSON.parse((await readBody(req)) || "{}");
            let entry = await uploadCreature(String(b.variant ?? ""));
            if (!entry) {
              entry = { id: `${Date.now()}-${b.variant}`, variant: String(b.variant ?? ""), at: Date.now() };
              devCreatures.unshift(entry);
            }
            return send(res, 200, { uploaded: true, entry });
          } catch (e: any) {
            return send(res, 500, { error: "server_error", detail: String(e?.message || e) });
          }
        }
        const cloud = await listCreatures();
        send(res, 200, { creatures: cloud.length ? cloud : devCreatures.slice(0, 60) });
      });
      route("/api/speak", "speak", (b) => speak(b.text, b.seed));
      // setup helper: GET-style voice catalog (POST {} works too) to pick TYPECAST_VOICE_ID
      server.middlewares.use("/api/voices", async (_req, res) => {
        const { status, body } = await listVoices();
        send(res, status, body);
      });
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
      // dev keepsake email (really sends if RESEND_API_KEY is in .env)
      route("/api/email", "email", async (b) => {
        const result = await sendKeepsakes(String(b.to ?? ""), String(b.monsterName ?? ""), b.attachments ?? []);
        return { status: 200, body: result };
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
  process.env.RESEND_API_KEY = env.RESEND_API_KEY || "";
  process.env.EMAIL_FROM = env.EMAIL_FROM || "";
  process.env.TYPECAST_API_KEY = env.TYPECAST_API_KEY || "";
  process.env.TYPECAST_VOICE_ID = env.TYPECAST_VOICE_ID || "";
  process.env.TYPECAST_MODEL = env.TYPECAST_MODEL || "";

  return {
    plugins: [react(), devApiPlugin()],
    server: { host: true, port: 5180 },
  };
});
