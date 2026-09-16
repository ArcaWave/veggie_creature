import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

// MediaPipe body-pose tracking for the dance mini-game. Assets are served
// locally (public/mediapipe/) so the kiosk never depends on a CDN mid-session.
// getPoseLandmarker() is memoised — the wasm+model load happens once.
let promise: Promise<PoseLandmarker> | null = null;

export function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!promise) {
    promise = (async () => {
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/mediapipe/pose_landmarker_lite.task", delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 4, // several kids can crowd the kiosk — track them all
      });
    })();
    promise.catch(() => (promise = null)); // allow a retry after a failed load
  }
  return promise;
}

// BlazePose landmark indices used by the gesture checks
export const NOSE = 0;
export const L_WRIST = 15;
export const R_WRIST = 16;
