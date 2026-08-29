import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// MediaPipe hand tracking for the dust-sprinkle interaction. Assets are served
// locally (public/mediapipe/) so a kiosk never depends on a CDN mid-session.
// getLandmarker() is memoised — the ~20MB wasm+model load happens once.
let promise: Promise<HandLandmarker> | null = null;

export function getLandmarker(): Promise<HandLandmarker> {
  if (!promise) {
    promise = (async () => {
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      return HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
    })();
    promise.catch(() => (promise = null)); // allow a retry after a failed load
  }
  return promise;
}

// Fingertip landmark indices (thumb..pinky) — dust falls from these points.
export const FINGERTIPS = [4, 8, 12, 16, 20];
