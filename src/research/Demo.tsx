// The stimulus check (/?research=demo): a clay character (any part set) in all six clips side by side, on the
// kiosk's own "살아났다!" scene, and the matching table — the same modules the kiosk plays, so what is measured
// here is exactly what the children see.
import { useEffect, useRef, useState } from "react";
import { STIMULI, DURATION, SW, SH, drawFrame, measure, coverTransform, type ClipMetrics, type Sprite } from "./stimuli";
import { composeFigure } from "./figure";
import { loadRig, type Parts } from "../components/Figure";

const NAMES: Record<string, string> = { pumpkin: "호박", corn: "옥수수", sweetpotato: "고구마", tomato: "토마토", cabbage: "양배추", none: "없음", leaves: "단풍", acorn: "도토리", straw: "밀짚", twig: "나뭇가지", cucumber: "오이", carrot: "당근" };

export function Demo() {
  const [opts, setOpts] = useState<{ bodies: string[]; hats: string[]; limbs: string[] } | null>(null);
  const [parts, setParts] = useState<Parts>({ body: "corn", hat: "straw", arms: "twig", legs: "carrot" });
  const [sprite, setSprite] = useState<Sprite | null>(null);
  const [metrics, setMetrics] = useState<ClipMetrics[]>([]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [bg, setBg] = useState<HTMLImageElement | null>(null);
  const stages = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    document.title = "Suggestiveness 자극 확인"; document.body.classList.add("research-demo");
    loadRig().then((r) => setOpts({ bodies: Object.keys(r.bodies), hats: ["none", ...Object.keys(r.hats)], limbs: r.arms }));
    const i = new Image(); i.onload = () => setBg(i); i.src = "/birth-stage.jpg";
    return () => document.body.classList.remove("research-demo");
  }, []);
  useEffect(() => { let live = true; composeFigure(parts).then((s) => { if (!live) return; setSprite(s); setMetrics(STIMULI.map((x) => measure(x.id, s))); }); return () => { live = false; }; }, [parts]);
  // the six clips at time t, each on the kiosk's scene (drawn with the scene's cover fit)
  useEffect(() => {
    STIMULI.forEach((s, i) => {
      const c = stages.current[i]; if (!c) return; const g = c.getContext("2d")!;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
      if (bg) { const k = Math.max(c.width / bg.width, c.height / bg.height); g.drawImage(bg, (c.width - bg.width * k) / 2, (c.height - bg.height * k) / 2, bg.width * k, bg.height * k); }
      const { k, ox, oy } = coverTransform(c.width, c.height); g.setTransform(k, 0, 0, k, ox, oy);
      drawFrame(g, s.id, sprite, t, 1, false, !bg);
    });
  }, [t, sprite, bg]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0; const t0 = performance.now() - t * 1000;
    const tick = (now: number) => { setT(((now - t0) / 1000) % DURATION); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const twin = (m: ClipMetrics) => metrics.find((o) => o.id !== m.id && o.id.slice(0, 6) === m.id.slice(0, 6));
  const cls = (a: number, b?: number) => (b === undefined ? "" : Math.abs(a - b) / Math.max(a, b, 1e-9) <= 0.2 ? "ok" : "warn");
  const pick = (k: keyof Parts, list: string[]) => (
    <label className="rd-pick">{({ body: "몸통", hat: "모자", arms: "팔", legs: "다리" } as Record<string, string>)[k]}
      <select id={`p-${k}`} value={parts[k]} onChange={(e) => setParts({ ...parts, [k]: e.target.value })}>
        {list.map((v) => <option key={v} value={v}>{NAMES[v] ?? v}</option>)}
      </select>
    </label>
  );
  return (
    <div className="rd">
      <header className="rd-head">
        <h1>Suggestiveness 자극 확인</h1>
        <p>체험의 "살아났다!" 장면에서 아이 캐릭터가 하는 6가지 영상(Pair A·B·C × LOW·HIGH)입니다. 모두 {DURATION}초, 같은 크기·시작/끝 자세, 텍스트·소리 없음. 키오스크와 같은 코드입니다.</p>
      </header>
      <section className="rd-card">
        <h2>캐릭터</h2>
        {opts && <div className="rd-picks">{pick("body", opts.bodies)}{pick("hat", opts.hats)}{pick("arms", opts.limbs)}{pick("legs", opts.limbs)}</div>}
      </section>
      <section className="rd-card">
        <h2>자극 6개</h2>
        <div className="rd-controls">
          <button className="rd-btn primary" type="button" onClick={() => setPlaying(!playing)}>{playing ? "❚❚ 멈춤" : "▶ 6개 재생"}</button>
          <input id="scrub" type="range" min={0} max={DURATION * 1000} step={10} value={Math.round(t * 1000)} aria-label="재생 위치" onChange={(e) => { setPlaying(false); setT(Number(e.target.value) / 1000); }} />
          <output>{t.toFixed(2)} s</output>
        </div>
        <div className="rd-grid">
          <div className="rd-corner" /><div className="rd-colhead">LOW</div><div className="rd-colhead">HIGH</div>
          {(["A", "B", "C"] as const).map((pair) => (
            <Row key={pair} pair={pair} stages={stages} />
          ))}
        </div>
      </section>
      <section className="rd-card">
        <h2>자극 비교</h2>
        <div className="rc-table"><table>
          <thead><tr><th>자극</th><th>움직임 양</th><th>움직임 있는 시간</th><th>캐릭터 보이는 시간</th><th>평균 밝기</th><th>평균 채도</th></tr></thead>
          <tbody>{metrics.map((m) => { const o = twin(m); return (
            <tr key={m.id}><td><code>{m.id}</code></td><td className={cls(m.motion, o?.motion)}>{m.motion.toFixed(1)}</td><td className={cls(m.moving, o?.moving)}>{m.moving.toFixed(1)} s</td>
              <td>{m.visible.toFixed(1)} s</td><td className={cls(m.lum, o?.lum)}>{m.lum}</td><td className={cls(m.sat, o?.sat)}>{m.sat}</td></tr>); })}</tbody>
        </table></div>
        <p className="rd-note">움직임 양 = 연속 프레임 사이 화면 변화의 합(무늬 없는 배경에서 잼). 같은 Pair 안의 차이가 ±20% 이내면 초록. Pair A는 LOW가 받침대를 가로질러 걷는 것 자체가 움직임이라 HIGH보다 크고, B·C는 HIGH의 마법 효과(빛·반짝이·꽃)만큼 HIGH가 큽니다 — 체험마다 그 아이가 본 영상의 움직임 양을 기록해 공변량으로 씁니다.</p>
      </section>
    </div>
  );
}

function Row({ pair, stages }: { pair: "A" | "B" | "C"; stages: React.MutableRefObject<(HTMLCanvasElement | null)[]> }) {
  const items = STIMULI.map((s, i) => ({ s, i })).filter((x) => x.s.pair === pair); // (LOW first, as listed)
  return (
    <>
      <div className="rd-pair"><b>Pair {pair}</b><span>{items[0].s.name}</span></div>
      {items.map(({ s, i }) => (
        <div key={s.id} className="rd-stage">
          <canvas ref={(el) => { stages.current[i] = el; }} width={SW * 1.5} height={SH * 1.5} role="img" aria-label={s.id} />
          <code className={s.cond === "LOW" ? "low" : "high"}>{s.id}</code>
        </div>
      ))}
    </>
  );
}
