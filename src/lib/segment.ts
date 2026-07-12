// Person segmentation for the photo booth's virtual background (same tech as
// Google Meet — MediaPipe Selfie Segmentation, runs on-device, free).
// Loaded lazily: the wasm + model download once from CDN (~a few MB), then cache.
type Segmenter = import("@mediapipe/tasks-vision").ImageSegmenter;

let seg: Segmenter | null = null;
let loading: Promise<Segmenter> | null = null;

export function loadSegmenter(): Promise<Segmenter> {
  if (seg) return Promise.resolve(seg);
  loading ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
    );
    seg = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    return seg;
  })();
  return loading;
}
