import type { ReactNode } from "react";

// The clay veggie picture frame around every camera view (welcome mirror,
// photo step, dance). The art (public/camera-frame.png, 3:2) has a
// transparent window; its inner edges were measured from the painting and
// live in .cam-window, so children render exactly inside the window while
// the characters in the corners sit on top.
export function CamFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`cam-frame ${className}`}>
      <div className="cam-window">{children}</div>
      <img src="/camera-frame.png" className="cam-frame-art" alt="" draggable={false} />
    </div>
  );
}
