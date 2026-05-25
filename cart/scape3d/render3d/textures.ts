// Procedural mesh textures — the fidelity the 2D shader quad painted per-pixel
// (window-grid facades, the neon plaza checker, asphalt), baked into small RGBA
// buffers and mapped onto box faces (each face gets full 0..1 UVs, so a texture
// shows once per face). Materials that carry a texture use "#ffffff" so the
// texture's own colours show true; the host caches by content hash, so every
// building of one style shares a single GPU texture.

type Tex = { width: number; height: number; hex: string };

function comp(hexColor: string): string {
  let s = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor;
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length === 6) s += 'ff';
  if (s.length !== 8) return 'ff00ffff';
  return s.toLowerCase();
}

// Deterministic 0..1 hash for cell variety (no Math.random — stable per build).
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// Lerp two colors in sRGB-ish space and return RRGGBBAA.
function mix(aHex: string, bHex: string, t: number): string {
  const a = comp(aHex);
  const b = comp(bHex);
  const c = (i: number) => {
    const av = parseInt(a.slice(i, i + 2), 16);
    const bv = parseInt(b.slice(i, i + 2), 16);
    return Math.round(av + (bv - av) * t).toString(16).padStart(2, '0');
  };
  return `${c(0)}${c(2)}${c(4)}ff`;
}

// ── plaza neon checker (cell-based so squares stay crisp under linear filter) ─
export function checkerTex(cols: number, rows: number, cell: number, aHex: string, bHex: string): Tex {
  const w = cols * cell;
  const h = rows * cell;
  let hex = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const ix = x % cell;
      const iy = y % cell;
      const onSeam = ix === 0 || iy === 0; // thin dark grout line between tiles
      const base = (cx + cy) % 2 === 0 ? aHex : bHex;
      hex += comp(onSeam ? mix(base, '#000000', 0.4) : base);
    }
  }
  return { width: w, height: h, hex };
}

// ── asphalt speckle (lane lines are now crisp geometry, not painted here) ───
export function asphaltTex(baseHex: string, _lineHex: string): Tex {
  const w = 16;
  const h = 16;
  let hex = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const speck = hash2(x, y) > 0.8;
      hex += comp(speck ? mix(baseHex, '#ffffff', 0.1) : baseHex);
    }
  }
  return { width: w, height: h, hex };
}

// ── building facade: lit window grid with dark frames ──────────────────────
export function facadeTex(wallHex: string, winHex: string, cols: number, rows: number): Tex {
  const cw = 9; // px per cell — higher res so windows stay crisp when stretched
  const ch = 9;
  const w = cols * cw;
  const h = rows * ch;
  let hex = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / cw);
      const cy = Math.floor(y / ch);
      const ix = x % cw;
      const iy = y % ch;
      // 2px mullion frame of wall around each window pane
      const onFrame = ix <= 1 || iy <= 1 || ix >= cw - 1 || iy >= ch - 1;
      if (onFrame) {
        hex += comp(wallHex);
        continue;
      }
      // some panes dark (unlit), some lit; deterministic per cell
      const lit = hash2(cx, cy) > 0.42;
      if (!lit) {
        hex += comp(mix(wallHex, '#000000', 0.5)); // dark glass
      } else {
        // brighter toward the top of the pane (a little reflected-sky sheen)
        const sheen = iy <= 2 ? 0.2 : 0;
        const t = Math.min(1, 0.55 + hash2(cx + 7, cy + 3) * 0.45 + sheen);
        hex += comp(mix(wallHex, winHex, t));
      }
    }
  }
  return { width: w, height: h, hex };
}
