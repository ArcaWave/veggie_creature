// The child's clay character as ONE picture for the stimuli: the same pre-made full-figure render and hat
// sticker the kiosk's <Figure> and the wall assemble (public/parts/rig.json + figures.json), composed on a
// canvas whose bottom is the feet. bodyFrac = the body's share of the picture's height (the hat sits above it).
import { loadRig, type Parts } from "../components/Figure";
import type { Sprite } from "./stimuli";

const img = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

export async function composeFigure(parts: Parts): Promise<Sprite> {
  let rig = await loadRig();
  const key = `${parts.body}_${parts.arms}_${parts.legs}`;
  if (!rig.bodies[parts.body] || !rig.figures[key]) rig = await loadRig(true);
  const b = rig.bodies[parts.body] ?? Object.values(rig.bodies)[0];
  const fig = rig.figures[key];
  const body = await img(fig ? `/parts/fig_${key}.png` : `/parts/cute_body_${parts.body}.png`);
  const H = body.naturalHeight, W = body.naturalWidth;
  const hat = parts.hat !== "none" ? rig.hats[parts.hat] : undefined;
  let hatImg: HTMLImageElement | null = null, hx = 0, hy = 0, hw = 0, hh = 0;
  if (hat) {
    try { hatImg = await img(hat.tex); } catch { hatImg = null; }
    hh = (hat.h / b.h) * H; hw = hh * hat.aspect;                       // (as <Figure> places it, in body pixels)
    hy = (fig?.hatY ?? b.hatY) * H - hh * hat.ay; hx = W / 2 - hw * hat.ax;
  }
  // (a hat wider than the body widens the picture on BOTH sides, so the body stays centred — the stimuli centre it)
  const top = hatImg ? Math.max(0, -hy) : 0, side = hatImg ? Math.max(0, -hx, hx + hw - W) : 0;
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(W + 2 * side), height: Math.round(H + top) }) as HTMLCanvasElement & { bodyFrac?: number };
  const g = c.getContext("2d")!;
  g.drawImage(body, side, top);
  if (hatImg) g.drawImage(hatImg, side + hx, top + hy, hw, hh);
  c.bodyFrac = H / (H + top);
  return c;
}
