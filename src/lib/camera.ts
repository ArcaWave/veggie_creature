// One camera stream for the whole kiosk session. The welcome mirror, the
// photo step and the dance game all look through the same webcam (mounted on
// top of the screen, facing the child), so the stream is acquired once and
// handed around instead of being stopped and re-opened between screens —
// no black gaps, no repeated permission prompts.
let pending: Promise<MediaStream> | null = null;

// ?fakecam=/welcome/step1.jpg — a still photo stands in for the webcam:
// rehearsals on a machine without one, and how the auto-start is tested.
// &orbit[=turns per second] slides the photo round in a small circle — the
// "child" in it is then stirring, which is how the magic-pot move is tested.
const QUERY = new URLSearchParams(location.search);
const FAKE = QUERY.get("fakecam");
// &then=/other.jpg&at=6: after `at` seconds the fake camera shows the other picture (an empty booth, then
// something held up — how the "creation alone" start is rehearsed)
const FAKE_THEN = QUERY.get("then"), FAKE_AT = Number(QUERY.get("at")) || 6;
const ORBIT = QUERY.has("orbit") ? Number(QUERY.get("orbit")) || 0.6 : 0;
function fakeStream(src: string): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let img2: HTMLImageElement | null = null;
    if (FAKE_THEN) { img2 = new Image(); img2.src = FAKE_THEN; }
    const t0 = performance.now();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = QUERY.has("cam43") ? 960 : 720; // &cam43: rehearse the wide 4:3 stream
      const ctx = c.getContext("2d")!;
      const W = window as any, myId = (W.__fakeCamSeq = (W.__fakeCamSeq || 0) + 1);
      const draw = () => { // cover-fit, redrawn so the stream keeps producing frames
        if (W.__fakecamStall === myId) return; // rehearsal: THIS camera session hangs (a re-opened one works)
        const pic = img2?.complete && img2.naturalWidth && performance.now() - t0 > FAKE_AT * 1000 ? img2 : img;
        const k = Math.max(c.width / pic.width, c.height / pic.height) * (ORBIT ? 1.25 : 1);
        const a = (performance.now() / 1000) * ORBIT * 2 * Math.PI, r = ORBIT ? c.height * 0.09 : 0;
        ctx.drawImage(pic, (c.width - pic.width * k) / 2 + r * Math.cos(a), (c.height - pic.height * k) / 2 + r * Math.sin(a), pic.width * k, pic.height * k);
        // (a real camera's sensor noise: the booth model must cope with it)
        if (FAKE_THEN) { ctx.fillStyle = `rgba(${Math.random() * 255 | 0},${Math.random() * 255 | 0},${Math.random() * 255 | 0},0.015)`; ctx.fillRect(0, 0, c.width, c.height); }
      };
      draw();
      setInterval(draw, ORBIT ? 33 : 100);
      resolve(c.captureStream(15));
    };
    img.onerror = () => reject(new DOMException("fake camera image missing", "NotFoundError"));
    img.src = src;
  });
}

// The webcam's WIDEST view. On most webcams the 16:9 stream is the 4:3 sensor
// with its top and bottom cut off, and some cameras start zoomed in. So once
// the stream is up: if the camera natively offers 4:3, switch to it (room above
// the child's head, and the frame no longer trims the sides); if it has a zoom
// control, open it all the way. Only when the camera SAYS it can — a 16:9-only
// camera forced to 4:3 would be cropped at the sides by the browser, the
// opposite of what we want. ?cam=169 keeps the plain 16:9 stream.
export const cameraInfo = { width: 0, height: 0, zoom: null as number | null, mode: "" };
async function widen(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities() as MediaTrackCapabilities & { zoom?: { min: number; max: number } };
  const note: string[] = [];
  try {
    if (QUERY.get("cam") !== "169" && (caps.aspectRatio?.min ?? 9) <= 1.36) {
      await track.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 } });
      const got = track.getSettings();
      if ((got.width ?? 0) < 960) { // only a tiny 4:3 mode: back to 16:9
        await track.applyConstraints({ width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } });
        note.push("4:3 too small");
      } else note.push("4:3");
    }
    if (caps.zoom && typeof caps.zoom.min === "number") {
      await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min } as MediaTrackConstraintSet] });
      note.push("zoom min");
    }
  } catch (e) { note.push(`(${(e as Error)?.name || "constraint failed"})`); }
  const s = track.getSettings() as MediaTrackSettings & { zoom?: number };
  cameraInfo.width = s.width ?? 0;
  cameraInfo.height = s.height ?? 0;
  cameraInfo.zoom = s.zoom ?? null;
  cameraInfo.mode = note.join(" ") || "16:9";
}

export function getCamera(): Promise<MediaStream> {
  if (pending) {
    // a stream that died (unplugged webcam) is re-acquired transparently
    return pending.then((s) => {
      if (s.active) return s;
      pending = null;
      return getCamera();
    });
  }
  startWatchdog();
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) {
    return Promise.reject(new DOMException("no camera", window.isSecureContext ? "NotFoundError" : "SecurityError"));
  }
  pending = (FAKE
    ? fakeStream(FAKE)
    : md.getUserMedia({ video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        .then(async (s) => { await widen(s); return s; })
  ).catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

// ---- keeping the picture alive, unattended, all day ------------------------
// A webcam can drop out mid-day: a USB hiccup or power-saving, a driver reset,
// the cable knocked, the camera replugged. The track then ends (or stays "live"
// but stops delivering frames), every <video> freezes on its last frame or goes
// black — and with no frames the auto-start can never fire again, so the
// station would stay dead until someone reloads it. The watchdog notices within
// ~4 s and re-opens the camera (retrying every few seconds while it is gone),
// and every <video> attached with attachCamera() is re-bound to the new stream.
// Health for staff: ?posedebug shows it; window.__camHealth() in the console.
const attached = new Map<HTMLVideoElement, { frames: number; at: number }>();
export const cameraHealth = { recoveries: 0, lastIssue: "", lastRecoveryAt: 0, stalledSince: 0 };
(window as any).__camHealth = () => ({ ...cameraHealth, attached: attached.size });

function bind(v: HTMLVideoElement, s: MediaStream) {
  if (v.srcObject !== s) v.srcObject = s;
  if (v.paused) v.play?.().catch(() => {});
}
// show the kiosk camera in this <video> (now, and again after any recovery); returns detach
export function attachCamera(v: HTMLVideoElement): () => void {
  attached.set(v, { frames: -1, at: performance.now() });
  pending?.then((s) => { if (attached.has(v)) bind(v, s); }).catch(() => {});
  return () => { attached.delete(v); };
}

let watching = false, recovering = false;
async function recover(reason: string) {
  if (recovering) return;
  recovering = true;
  cameraHealth.lastIssue = `${reason} @ ${new Date().toLocaleTimeString()}`;
  console.warn("[camera] recovering:", reason);
  const old = pending;
  pending = null;
  old?.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
  try {
    const s = await getCamera();
    cameraHealth.recoveries++;
    cameraHealth.lastRecoveryAt = Date.now();
    for (const v of attached.keys()) bind(v, s);
    for (const f of recoveryListeners) f(s);
  } catch (e) {
    cameraHealth.lastIssue = `${reason}; reopen failed: ${(e as Error)?.name || e}`; // tried again on the next tick
  } finally {
    recovering = false;
    for (const rec of attached.values()) { rec.frames = -1; rec.at = performance.now(); }
  }
}
const recoveryListeners = new Set<(s: MediaStream) => void>();
export function onCameraRecovered(f: (s: MediaStream) => void) { recoveryListeners.add(f); return () => { recoveryListeners.delete(f); }; }

function startWatchdog() {
  if (watching) return;
  watching = true;
  const STALL_MS = 4000;
  window.setInterval(() => {
    if (document.hidden || recovering) return; // (a hidden page gets no frames — that's not a fault)
    if (!pending) { void recover("no stream"); return; }
    pending.then((s) => {
      const track = s.getVideoTracks()[0];
      if (!track || track.readyState === "ended") { void recover("track ended"); return; }
      // frames actually arriving on screen (a live-but-muted track delivers none)
      const now = performance.now();
      let fresh = false, watched = 0;
      for (const [v, rec] of attached) {
        if (!v.isConnected) { attached.delete(v); continue; }
        watched++;
        if (v.srcObject !== s) bind(v, s); // (a stale binding, e.g. a <video> that remounted mid-recovery)
        const frames = (v as any).getVideoPlaybackQuality?.().totalVideoFrames ?? -1;
        if (frames < 0 || frames !== rec.frames || v.readyState < 2 && now - rec.at < STALL_MS) { if (frames !== rec.frames) { rec.frames = frames; rec.at = now; } fresh = true; }
        else if (now - rec.at < STALL_MS) fresh = true;
      }
      cameraHealth.stalledSince = watched && !fresh ? cameraHealth.stalledSince || Date.now() : 0;
      if (watched && !fresh) void recover(track.muted ? "no frames (track muted)" : "no frames");
    }).catch(() => void recover("stream failed"));
  }, 1000);
}

// stop the stream so the next getCamera() starts fresh (retry after a stall)
export function releaseCamera() {
  const p = pending;
  pending = null;
  p?.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
}

export function cameraErrorText(err: unknown): string {
  const name = (err as DOMException)?.name;
  const byName: Record<string, string> = {
    NotAllowedError: "카메라가 막혀 있어요 — 허용 후 다시 시도!",
    NotFoundError: "카메라가 없어요 — 사진을 업로드해 주세요!",
    NotReadableError: "다른 앱이 카메라를 쓰고 있어요.",
    SecurityError: "카메라는 https 주소에서 열 수 있어요.",
  };
  return byName[name ?? ""] || "카메라가 잠깐 말썽이에요 — 다시 시도!";
}

// Where the preview's cover-fit crop sits (CSS object-position of the camera
// <video>s): centred sideways, biased UP — with a 4:3 stream in the wide clay
// window it is the floor that gets trimmed, not the head room. Everything that
// maps video coordinates onto the screen (overlays, the snapshot) uses this.
export const CAM_FOCUS = { x: 0.5, y: 0.3 };

// the cover-fit placement of the video inside its box: scale and offsets
export function coverFit(v: HTMLVideoElement, cw: number, ch: number) {
  const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
  return { s, ox: (cw - v.videoWidth * s) * CAM_FOCUS.x, oy: (ch - v.videoHeight * s) * CAM_FOCUS.y };
}

// WYSIWYG snapshot: exactly the region the (object-fit: cover) preview shows,
// scaled to at most `max` px, as a JPEG data URL for the matcher
// `focus` (video-normalised box, optional): with several people in frame, only the region around the
// child being followed — so the matcher reads THEIR creation, not the one a sibling holds up beside
// them. The box is clamped into the frame and to a sensible minimum size.
export function snapshot(v: HTMLVideoElement, max = 960, focus?: { x0: number; y0: number; x1: number; y1: number } | null): string {
  const ratio = v.clientWidth && v.clientHeight ? v.clientWidth / v.clientHeight : 1;
  let cw = v.videoWidth, ch = v.videoHeight;
  if (cw / ch > ratio) cw = Math.round(ch * ratio);
  else ch = Math.round(cw / ratio);
  let sx = (v.videoWidth - cw) * CAM_FOCUS.x, sy = (v.videoHeight - ch) * CAM_FOCUS.y;
  if (focus) {
    const fw = Math.max(0.3, focus.x1 - focus.x0) * v.videoWidth, fh = Math.max(0.35, focus.y1 - focus.y0) * v.videoHeight;
    const cx = ((focus.x0 + focus.x1) / 2) * v.videoWidth, cy = ((focus.y0 + focus.y1) / 2) * v.videoHeight;
    cw = Math.min(v.videoWidth, Math.round(fw)); ch = Math.min(v.videoHeight, Math.round(fh));
    sx = Math.max(0, Math.min(v.videoWidth - cw, cx - cw / 2)); sy = Math.max(0, Math.min(v.videoHeight - ch, cy - ch / 2));
  }
  const scale = Math.min(1, max / Math.max(cw, ch));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(v, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}
