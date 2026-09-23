// Promo stills of the Digital Village: every scene with a crowd, speech bubbles and the QR carrier
// passing, no controls on screen. Needs `npm run dev` (or `npm run kiosk`) on :5180.
//   node tools/promo_shots.mjs            1920x1080 PNGs into .shots/promo/
//   node tools/promo_shots.mjs --2x       3840x2160 (the characters are sharp; the painted
//                                          backdrops are 1672 px wide, so they soften at 2x)
//   node tools/promo_shots.mjs harvest moon   only these scenes
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
const scale = process.argv.includes("--2x") ? 2 : 1;
const ALL = ["harvest", "field", "night", "moon", "market"];
const scenes = process.argv.slice(2).filter((a) => ALL.includes(a));
const OUT = `${process.cwd()}/.shots/promo`;
fs.mkdirSync(OUT, { recursive: true });
const PORT = 9420;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${PORT}`, "--window-size=1920,1080", `--user-data-dir=${fs.mkdtempSync(os.tmpdir() + "/vc-promo-")}`, "--mute-audio", "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target; for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const waiting = new Map();
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, "base64")); console.log("  ", `${name}.png`); };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: scale, mobile: false });
for (const bg of scenes.length ? scenes : ALL) {
  console.log(bg);
  await send("Page.navigate", { url: `http://localhost:5180/world.html?bg=${bg}&demo&seed=1&stay=900&bgm=0&clean&debug&banner=24` });
  await sleep(9000); await shot(`${bg}_1`);            // the crowd, a newcomer's welcome
  await sleep(6000); await shot(`${bg}_2`);            // chatter, emotes
  for (let i = 0; i < 60; i++) { if ((await ev(`window.__vc3d?.banner?.phase`)) === "hover") break; await sleep(500); }
  await sleep(3500); await shot(`${bg}_qr`);           // the QR carrier passing
}
ws.close(); chrome.kill("SIGKILL");
console.log("→", OUT);
