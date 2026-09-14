// A looping character clip. AnimatedDrawings clips arrive as GIF data URLs
// (rendered by <img>), Veo clips as mp4 data URLs (rendered by <video>) —
// this picks the right element so every screen can stay engine-agnostic.
export function Clip({ src, className }: { src: string; className?: string }) {
  if (src.startsWith("data:image")) {
    return <img src={src} className={className} alt="" />;
  }
  return <video src={src} className={className} autoPlay loop muted playsInline />;
}
