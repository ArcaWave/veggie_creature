// Rehearse the scan station without a webcam or a child: drives a headless
// Chrome over CDP (no dependencies) through welcome → match → dance, and
// photographs the magic-pot finale into .shots/drive/. Needs `npm run dev`.
//   node tools/drive_kiosk.mjs                  orbiting fake webcam (= a child stirring), scenes 1–2 tapped through
//   node tools/drive_kiosk.mjs <url> --play12   no taps: every scene must complete by itself (still photo = idle child)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
const OUT = `${process.cwd()}/.shots/drive`, PORT = 9333;
fs.mkdirSync(OUT, { recursive: true });
const URL0 = (process.argv[2]?.startsWith("http") && process.argv[2]) || "http://localhost:5180/?fakecam=/welcome/step1.jpg&orbit=0.6";
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--window-size=1920,1080", `--user-data-dir=${fs.mkdtempSync(os.tmpdir() + "/vc-drive-")}`,
  "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const waiting = new Map(); const logs = [];
ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); }
  if (j.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(j.params.type)) logs.push(j.params.type + ": " + j.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (j.method === "Runtime.exceptionThrown") logs.push("EXC: " + (j.params.exceptionDetails.exception?.description || j.params.exceptionDetails.text).slice(0, 400)); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return "EVAL-ERR " + JSON.stringify(r.result.exceptionDetails).slice(0, 300); return r.result?.result?.value; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 }); fs.writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(r.result.data, "base64")); console.log("shot", name); };
const until = async (expr, ms = 40000, every = 80) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(every); } return false; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: URL0 });
console.log("welcome:", await until(`!!document.querySelector('.mirror video')`));
await sleep(2500);
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))`);
console.log("dance:", await until(`!!document.querySelector('.dance-stage')`, 60000));
const FAST = process.argv.includes("--play12") ? false : true; // tap through scenes 1 and 2
if (FAST) console.log("stir:", await until(`(() => { document.querySelector('.dance-stage')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return (document.querySelector('.move-title')?.textContent || '').includes('냄비'); })()`, 30000, 40));
else console.log("stir:", await until(`(document.querySelector('.move-title')?.textContent || '').includes('냄비')`, 90000));
const t0 = Date.now(); const trace = [];
const state = () => ev(`({ g: document.querySelector('.magic-gauge-label')?.textContent, p: document.querySelector('.dance-prompt')?.textContent, stirring: !!document.querySelector('.stir-pot.stirring'), burst: !!document.querySelector('.stir-pot.burst'), white: !!document.querySelector('.stir-whiteout'), birth: document.querySelector('.birth-stage')?.className, title: document.querySelector('.birth-title')?.textContent })`);
await sleep(900); await shot("1_photo_drop");
let n = 2, lastShot = Date.now(), burstAt = 0, whiteShot = false, aliveAt = 0;
while (Date.now() - t0 < 45000) {
  const s = await state(); trace.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(s)}`);
  if (!burstAt && !s?.birth && Date.now() - lastShot > 1800 && n < 5) { await shot(`${n++}_stirring`); lastShot = Date.now(); }
  if (s?.burst && !burstAt) { burstAt = Date.now(); await sleep(250); await shot("5_burst_a"); await sleep(350); await shot("6_burst_b"); }
  if (s?.white && !whiteShot) { whiteShot = true; await shot("7_whiteout"); }
  if (s?.birth && !aliveAt) { aliveAt = Date.now(); await shot("8_alive_0"); await sleep(450); await shot("9_alive_1"); await sleep(1200); await shot("10_alive_2"); break; }
  await sleep(120);
}
console.log(trace.filter((_, i) => i % 4 === 0).join("\n"));
console.log("LOGS:\n" + logs.slice(0, 20).join("\n"));
ws.close(); chrome.kill("SIGKILL");
