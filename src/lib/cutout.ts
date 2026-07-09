// Client-side background removal for the clay image.
// The clay is generated on a "solid pastel background", so we flood-fill from the
// edges (removing only the connected background, not similar colors inside the
// character), then crop tightly to the character. Returns a transparent PNG data URL.
export async function removeBackground(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const W = img.width, H = img.height;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;

  // background reference = the four corner colors, matched separately
  // (handles gradient backgrounds without widening the tolerance).
  const cornerPos = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + (W - 1)) * 4];
  const bgs = cornerPos.map((o) => [d[o], d[o + 1], d[o + 2]]);

  // conservative tolerance: better to leave a little background than to eat
  // part of the character.
  const tol = 34;
  const tol2 = tol * tol;
  const near = (o: number) =>
    bgs.some(([r, g, b]) => {
      const dr = d[o] - r, dg = d[o + 1] - g, db = d[o + 2] - b;
      return dr * dr + dg * dg + db * db < tol2;
    });

  const visited = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (p < 0 || p >= W * H || visited[p]) continue;
    const o = p * 4;
    if (!near(o)) continue;
    visited[p] = 1;
    d[o + 3] = 0; // make transparent
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }

  // edge-restore pass: bring back removed pixels that are mostly surrounded by
  // the character (fixes nibbled outlines/highlights along its silhouette).
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (d[p * 4 + 3] !== 0) continue;
      let solid = 0;
      for (const n of [p - 1, p + 1, p - W, p + W, p - W - 1, p - W + 1, p + W - 1, p + W + 1]) {
        if (d[n * 4 + 3] > 0) solid++;
      }
      if (solid >= 5) d[p * 4 + 3] = 255; // rgb is still intact — just un-hide it
    }
  }
  ctx.putImageData(id, 0, 0);

  // crop to the character's bounding box
  let minx = W, miny = H, maxx = 0, maxy = 0, any = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 12) {
        any = true;
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (!any) return dataUrl;
  const cw = maxx - minx + 1, ch = maxy - miny + 1;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d")!.drawImage(c, minx, miny, cw, ch, 0, 0, cw, ch);
  return out.toDataURL("image/png");
}

// In-place per-frame background removal (edge flood-fill), for live video keying.
// Makes edge-connected background pixels transparent; leaves the character intact.
export function keyFrameFloodFill(d: Uint8ClampedArray, W: number, H: number, tol = 48) {
  const corners = [0, (W - 1) * 4, (H - 1) * W * 4, ((H - 1) * W + (W - 1)) * 4];
  let br = 0, bg = 0, bb = 0;
  for (const o of corners) { br += d[o]; bg += d[o + 1]; bb += d[o + 2]; }
  br /= 4; bg /= 4; bb /= 4;
  const tol2 = tol * tol;
  const near = (o: number) => {
    const dr = d[o] - br, dg = d[o + 1] - bg, db = d[o + 2] - bb;
    return dr * dr + dg * dg + db * db < tol2;
  };
  const visited = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (p < 0 || p >= W * H || visited[p]) continue;
    const o = p * 4;
    if (!near(o)) continue;
    visited[p] = 1;
    d[o + 3] = 0;
    const x = p % W, y = (p / W) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}
