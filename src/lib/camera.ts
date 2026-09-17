// One camera stream for the whole kiosk session. The welcome mirror, the
// photo step and the dance game all look through the same webcam (mounted on
// top of the screen, facing the child), so the stream is acquired once and
// handed around instead of being stopped and re-opened between screens —
// no black gaps, no repeated permission prompts.
let pending: Promise<MediaStream> | null = null;

// ?fakecam=/welcome/step1.jpg — a still photo stands in for the webcam:
// rehearsals on a machine without one, and how the auto-start is tested
const FAKE = new URLSearchParams(location.search).get("fakecam");
function fakeStream(src: string): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      const ctx = c.getContext("2d")!;
      const draw = () => { // cover-fit, redrawn so the stream keeps producing frames
        const k = Math.max(c.width / img.width, c.height / img.height);
        ctx.drawImage(img, (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k);
      };
      draw();
      setInterval(draw, 100);
      resolve(c.captureStream(15));
    };
    img.onerror = () => reject(new DOMException("fake camera image missing", "NotFoundError"));
    img.src = src;
  });
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
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) {
    return Promise.reject(new DOMException("no camera", window.isSecureContext ? "NotFoundError" : "SecurityError"));
  }
  pending = (FAKE
    ? fakeStream(FAKE)
    : md.getUserMedia({ video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
  ).catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
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

// WYSIWYG snapshot: exactly the region the (object-fit: cover) preview shows,
// scaled to at most `max` px, as a JPEG data URL for the matcher
export function snapshot(v: HTMLVideoElement, max = 960): string {
  const ratio = v.clientWidth && v.clientHeight ? v.clientWidth / v.clientHeight : 1;
  let cw = v.videoWidth, ch = v.videoHeight;
  if (cw / ch > ratio) cw = Math.round(ch * ratio);
  else ch = Math.round(cw / ratio);
  const scale = Math.min(1, max / Math.max(cw, ch));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(v, (v.videoWidth - cw) / 2, (v.videoHeight - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}
