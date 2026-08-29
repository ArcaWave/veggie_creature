import { useEffect, useRef, useState } from "react";
import { getLandmarker } from "./hands";

export type WaveStatus = "idle" | "watching" | "denied" | "unsupported";

// Front-camera "wave back" detector (MediaPipe hands). It fires onWave once when
// the child shows an OPEN PALM and waves it side to side — so a random passer-by
// or a bumped table no longer counts, but the gesture stays forgiving:
//  - open palm + 2 direction changes  -> wave!  (a real hello)
//  - open palm held ~2s               -> wave!  (for children who hold still)
// The camera stops as soon as `enabled` turns false or the component unmounts.
export function useWaveDetector(enabled: boolean, onWave: () => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<WaveStatus>("idle");
  const onWaveRef = useRef(onWave);
  onWaveRef.current = onWave;

  // The <video> only renders AFTER status flips to "watching", so the stream must
  // be (re)bound here — binding inside getUserMedia's callback would hit a null ref.
  useEffect(() => {
    const v = videoRef.current;
    if (status === "watching" && v && streamRef.current) {
      v.srcObject = streamRef.current;
      v.play?.().catch(() => {});
    }
  }, [status]);

  useEffect(() => {
    if (!enabled) return;

    let raf = 0;
    let cancelled = false;
    let fired = false;
    let stream: MediaStream | null = null;

    let openMs = 0; // how long an open palm has been visible
    let lastTs = 0;
    let lastX: number | null = null; // wrist x while palm is open
    let lastDir = 0; // -1 | 0 | 1
    let flips = 0; // direction changes while open

    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    (async () => {
      try {
        const [landmarker, s] = await Promise.all([
          getLandmarker(),
          md.getUserMedia({ video: { facingMode: { ideal: "user" }, width: { ideal: 480 } }, audio: false }),
        ]);
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        streamRef.current = s;
        setStatus("watching");

        const loop = () => {
          if (cancelled) return;
          raf = requestAnimationFrame(loop);
          const v = videoRef.current;
          if (!v || v.readyState < 2 || fired) return;
          const now = performance.now();
          const dt = lastTs ? Math.min(80, now - lastTs) : 16;
          lastTs = now;

          const res = landmarker.detectForVideo(v, now);
          const lm = res.landmarks?.[0];
          let open = false;
          if (lm) {
            // open palm = fingertips far from the palm centre (same metric as the dust game)
            const cx = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
            const cy = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
            const scale = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 0.1;
            const openness =
              [8, 12, 16, 20].reduce((t, i) => t + Math.hypot(lm[i].x - cx, lm[i].y - cy), 0) / 4 / scale;
            open = openness > 1.3;

            if (open) {
              openMs += dt;
              // count side-to-side direction changes of the wrist
              const x = lm[0].x;
              if (lastX !== null) {
                const dx = x - lastX;
                if (Math.abs(dx) > 0.006) {
                  const dir = dx > 0 ? 1 : -1;
                  if (lastDir !== 0 && dir !== lastDir) flips += 1;
                  lastDir = dir;
                }
              }
              lastX = x;
            }
          }
          if (!open) {
            // palm dropped — decay instead of hard reset (tracking flickers)
            openMs = Math.max(0, openMs - dt * 2);
            if (openMs === 0) {
              flips = 0;
              lastDir = 0;
              lastX = null;
            }
          }

          const waved = openMs > 400 && flips >= 2; // real hello wave
          const heldOpen = openMs > 2000; // steady open palm also counts
          if (waved || heldOpen) {
            fired = true;
            onWaveRef.current();
          }
        };
        raf = requestAnimationFrame(loop);
      } catch {
        if (!cancelled) setStatus("denied");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { videoRef, status };
}
