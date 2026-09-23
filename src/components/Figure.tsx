import { useEffect, useState } from "react";

// The SAME character the Digital Village shows, composed the same way: the
// pre-made full-figure render for body×arms×legs (public/parts/fig_*.png)
// with the hat sticker seated on its socket. Geometry comes from
// public/parts/rig.json, which the wall (world.html) reads too — one source
// of truth, so what walks off the scan station is what pops up on the wall.
export type Parts = { body: string; hat: string; arms: string; legs: string };

type Rig = {
  bodies: Record<string, { h: number; hatY: number }>;
  hats: Record<string, { tex: string; h: number; aspect: number; ax: number; ay: number }>;
  arms: string[];
  legs: string[];
  figures: Record<string, { aspect: number; hatY?: number }>; // hatY: this figure's own hat socket
};

let rigPromise: Promise<Rig> | null = null;
let rigAt = 0;
// (fresh=true: read it again — the station has been open since before a deploy that added this part)
export function loadRig(fresh = false): Promise<Rig> {
  if (fresh && performance.now() - rigAt > 3000) rigPromise = null;
  if (!rigPromise) {
    rigAt = performance.now();
    rigPromise = Promise.all([
      fetch("/parts/rig.json", { cache: "no-store" }).then((r) => r.json()),
      fetch("/parts/figures.json", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([rig, figures]) => ({ ...rig, figures }));
    rigPromise.catch(() => (rigPromise = null));
  }
  return rigPromise;
}

// a random but valid part set (the matcher failed or had no key)
export async function randomParts(body: string): Promise<Parts> {
  const rig = await loadRig();
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  return { body: rig.bodies[body] ? body : Object.keys(rig.bodies)[0], hat: pick(["none", ...Object.keys(rig.hats)]), arms: pick(rig.arms), legs: pick(rig.legs) };
}

export function Figure({ parts, className = "" }: { parts: Parts; className?: string }) {
  const [rig, setRig] = useState<Rig | null>(null);
  const [bodyShown, setBodyShown] = useState(false); // the hat waits for its body: never a hat on its own
  useEffect(() => {
    let live = true;
    loadRig().then((r) => {
      // a part this (long-running) page doesn't know yet: the catalog is read again first
      if (!r.bodies[parts.body] || !r.figures[`${parts.body}_${parts.arms}_${parts.legs}`]) return loadRig(true);
      return r;
    }).then((r) => { if (live) setRig(r); }).catch(() => {});
    return () => { live = false; };
  }, [parts.body, parts.arms, parts.legs]);
  useEffect(() => setBodyShown(false), [parts.body, parts.arms, parts.legs]);
  if (!rig) return <div className={`figure ${className}`} />;

  const b = rig.bodies[parts.body] ?? Object.values(rig.bodies)[0];
  const key = `${parts.body}_${parts.arms}_${parts.legs}`;
  const fig = rig.figures[key];
  const src = fig ? `/parts/fig_${key}.png` : `/parts/cute_body_${parts.body}.png`;
  const aspect = fig?.aspect ?? 0.7;
  const hat = rig.hats[parts.hat];
  // hat placement in % of the body box (its height = the body's height, its
  // width = height × aspect): the hat's anchor (ax, ay) sits on the socket
  const hatH = hat ? (hat.h / b.h) * 100 : 0;
  const hatW = hat ? ((hat.h / b.h) * hat.aspect) / aspect * 100 : 0;
  const hatTop = hat ? (fig?.hatY ?? b.hatY) * 100 - hatH * hat.ay : 0;
  const hatLeft = hat ? 50 - hatW * hat.ax : 0;

  return (
    <div className={`figure ${className}`}>
      <div className="figure-body" style={{ aspectRatio: String(aspect) }}>
        <img src={src} alt="" draggable={false} onLoad={() => setBodyShown(true)} />
        {hat && bodyShown && (
          <img
            className="figure-hat"
            src={hat.tex}
            alt=""
            draggable={false}
            style={{ height: `${hatH}%`, width: `${hatW}%`, top: `${hatTop}%`, left: `${hatLeft}%` }}
          />
        )}
      </div>
    </div>
  );
}
