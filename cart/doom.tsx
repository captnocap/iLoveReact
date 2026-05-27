// doom — id Software DOOM, rendered inside a React component tree.
//
// Two modes ship in the same cart:
//
//   'boxes'   — 80×50 grid of <Box> components. Each box's
//               backgroundColor is updated each frame from a downsampled
//               sample of the doomgeneric framebuffer. Looks chunky,
//               reads obviously as "this is rendered in React."
//
//   'shader'  — single <Effect> quad. The 640×400 framebuffer is
//               downsampled to 160×100 = 16k floats and uploaded as the
//               effect's storage buffer; the WGSL shader unpacks each
//               float into RGB and paints with nearest-neighbour. Higher
//               resolution + GPU-rasterised, but the Effect data path
//               currently routes through JSON, so we can't push the
//               full 640×400 every frame yet — 160×100 is the comfortable
//               ceiling.
//
// Toggle modes with M. WAD path defaults to one of the well-known
// locations (shareware doom1.wad, freedoom1.wad, or a user drop in
// ~/.local/share/reactjit/wads/). Drop a WAD at one of those paths.
//
// Keys (always-on regardless of mode):
//   ArrowKeys  — move
//   Space      — use / open door
//   Ctrl       — fire
//   Enter      — confirm
//   Escape     — menu
//   Y / N      — yes/no in dialogs
//   M          — toggle render mode

import { useMemo, useState } from 'react';
import { Box, Effect } from '@reactjit/runtime/primitives';
import { useDoom, DOOM_WIDTH, DOOM_HEIGHT } from '@reactjit/runtime/hooks/useDoom';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import { envGet } from '@reactjit/runtime/hooks/process';
import { exists as fsExists } from '@reactjit/runtime/hooks/fs';

// ── WAD discovery ─────────────────────────────────────────────────────────
//
// doomgeneric needs a WAD file. We don't ship one (id never released
// commercial WADs free; freedoom is BSD-licensed but the user adds it).
// Walk a list of conventional paths, return the first that __fs_read
// can open. If none, fall back to the first candidate so doomgeneric's
// own error message at least names a path.
function pickWad(): string {
  const home = envGet('HOME') ?? '';
  const candidates = [
    // User drop-zone — preferred, survives system pkg upgrades.
    `${home}/.local/share/reactjit/wads/doom1.wad`,
    `${home}/.local/share/reactjit/wads/freedoom1.wad`,
    `${home}/.local/share/reactjit/wads/DOOM.WAD`,
    // System packages (apt install doom-wad-shareware / freedoom).
    '/usr/share/games/doom/doom1.wad',
    '/usr/share/games/doom/freedoom1.wad',
    '/usr/share/doom/doom1.wad',
  ];
  for (const p of candidates) {
    if (fsExists(p)) return p;
  }
  return candidates[0];
}

// ── Box-grid mode ─────────────────────────────────────────────────────────

// Grid resolution. Each cell is one Box; per-frame React diffs only the
// cells whose color actually changed, so static menu screens reconcile
// near-zero cost and only motion-frames push real UPDATE_NODE_PROP volume.
// 80×50 (4000 cells) is the comfortable ceiling; 100×62 is visibly fine
// in shareware Doom menus but starts to chug during demo combat.
const GRID_W = 80;
const GRID_H = 50;
const SAMPLE_DX = DOOM_WIDTH / GRID_W;
const SAMPLE_DY = DOOM_HEIGHT / GRID_H;

function sampleBoxes(fb: Uint32Array): string[] {
  // doomgeneric pixel: 0x00RRGGBB in native u32 endianness (little-endian
  // on x86-64). We read bytes via shifts; #rrggbb hex string for the
  // backgroundColor prop. ~4000 strings per frame — most are stable
  // between samples so React reconciles cheaply on the matching nodes.
  const out = new Array<string>(GRID_W * GRID_H);
  let idx = 0;
  for (let gy = 0; gy < GRID_H; gy++) {
    const sy = Math.floor(gy * SAMPLE_DY + SAMPLE_DY * 0.5);
    const row = sy * DOOM_WIDTH;
    for (let gx = 0; gx < GRID_W; gx++) {
      const sx = Math.floor(gx * SAMPLE_DX + SAMPLE_DX * 0.5);
      const p = fb[row + sx];
      const r = (p >>> 16) & 0xff;
      const g = (p >>> 8) & 0xff;
      const b = p & 0xff;
      // Pre-pad single hex digits via OR with 0x1000000 → slice(-6).
      out[idx++] = '#' + (((r << 16) | (g << 8) | b) | 0x1000000).toString(16).slice(-6);
    }
  }
  return out;
}

const CELL = 8; // px per Box-pixel — 80×50 cells × 8px = 640×400, matches doom native
const BOXES_W = GRID_W * CELL;
const BOXES_H = GRID_H * CELL;

function BoxesMode({ colors }: { colors: string[] }) {
  // Explicit pixel sizing instead of nested flexGrow — empty cells with
  // no intrinsic dimensions collapse to 0 under this framework's layout
  // (verified by an earlier blank-screen run). Fixed CELL keeps the grid
  // visible and predictable.
  const rows: any[] = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    const cells: any[] = [];
    for (let gx = 0; gx < GRID_W; gx++) {
      const idx = gy * GRID_W + gx;
      cells.push(
        <Box key={gx} style={{ width: CELL, height: CELL, backgroundColor: colors[idx] }} />,
      );
    }
    rows.push(
      <Box key={gy} style={{ flexDirection: 'row', width: BOXES_W, height: CELL }}>
        {cells}
      </Box>,
    );
  }
  return (
    <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
      <Box style={{ width: BOXES_W, height: BOXES_H, flexDirection: 'column' }}>
        {rows}
      </Box>
    </Box>
  );
}

// ── Shader mode ───────────────────────────────────────────────────────────

const SHADER_W = 160;
const SHADER_H = 100;
const SHADER_DX = DOOM_WIDTH / SHADER_W;
const SHADER_DY = DOOM_HEIGHT / SHADER_H;

const DOOM_SHADER = `
@group(0) @binding(1) var<storage, read> fb: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let W: f32 = 160.0;
  let H: f32 = 100.0;
  let u = clamp(in.uv.x, 0.0, 0.999);
  let v = clamp(in.uv.y, 0.0, 0.999);
  let x: u32 = u32(u * W);
  let y: u32 = u32(v * H);
  let raw: u32 = bitcast<u32>(fb[y * u32(W) + x]);
  let r = f32((raw >> 16u) & 0xFFu) / 255.0;
  let g = f32((raw >> 8u) & 0xFFu) / 255.0;
  let b = f32(raw & 0xFFu) / 255.0;
  return vec4f(r, g, b, 1.0);
}
`;

function packShaderData(fb: Uint32Array): number[] {
  // f32-encoded BGRA pixels — the bit pattern survives JSON since we
  // store via a typed-array view, then push numeric values that the
  // engine parses back into a Float32Array on the Zig side. WGSL
  // bitcast<u32> recovers the original RGB.
  const u32 = new Uint32Array(SHADER_W * SHADER_H);
  for (let sy = 0; sy < SHADER_H; sy++) {
    const fy = Math.floor(sy * SHADER_DY + SHADER_DY * 0.5);
    const row = fy * DOOM_WIDTH;
    const outRow = sy * SHADER_W;
    for (let sx = 0; sx < SHADER_W; sx++) {
      const fx = Math.floor(sx * SHADER_DX + SHADER_DX * 0.5);
      u32[outRow + sx] = fb[row + fx];
    }
  }
  // Reinterpret the same bits as f32 (NaN-safe for our purposes — we
  // bitcast back to u32 in the shader before reading channels).
  const f32 = new Float32Array(u32.buffer);
  const arr = new Array<number>(f32.length);
  for (let i = 0; i < f32.length; i++) arr[i] = f32[i];
  return arr;
}

function ShaderMode({ fb }: { fb: Uint32Array }) {
  const data = useMemo(() => packShaderData(fb), [fb, fb[0], fb[1000]]);
  return (
    <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: 'theme:bg' }}>
      <Box style={{ width: DOOM_WIDTH, height: DOOM_HEIGHT, borderRadius: 4, overflow: 'hidden' }}>
        <Effect shader={DOOM_SHADER} data={data} style={{ width: DOOM_WIDTH, height: DOOM_HEIGHT }} />
      </Box>
    </Box>
  );
}

// ── Cart ──────────────────────────────────────────────────────────────────

export default function DoomCart() {
  const wadPath = useMemo(() => pickWad(), []);
  const doom = useDoom({ wad: wadPath, fps: 35 });

  const [mode, setMode] = useState<'boxes' | 'shader'>('boxes');

  // Key piping lives inside useDoom — it wraps the SDL key chain and
  // sends every keypress to doomgeneric, including Ctrl/Shift which IFTTT
  // 'key:X' specs don't surface. The cart only needs to bind shortcuts
  // that should ALSO trigger UI side-effects (mode toggle below).
  useIFTTT('key:`', () => setMode((m) => (m === 'boxes' ? 'shader' : 'boxes')));

  // Boxes mode: derive the color array each frame from the bumped doom.frame.
  const colors = useMemo(() => {
    if (!doom.framebuffer) return null;
    return sampleBoxes(doom.framebuffer);
    // doom.frame is the trigger — same framebuffer pointer, different
    // contents.
  }, [doom.frame, doom.framebuffer]);

  if (!doom.ready || !doom.framebuffer || !colors) {
    return (
      <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: 'theme:bg' }}>
        <Box style={{ color: 'theme:text', padding: 16 }}>
          <BootSplash wadPath={wadPath} />
        </Box>
      </Box>
    );
  }

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: 'theme:bg' }}>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 8, color: 'theme:text' }}>
        <Box>doom — mode: {mode} — press M to toggle</Box>
        <Box>frame {doom.frame}</Box>
      </Box>
      <Box style={{ flexGrow: 1 }}>
        {mode === 'boxes'
          ? <BoxesMode colors={colors} />
          : <ShaderMode fb={doom.framebuffer} />}
      </Box>
    </Box>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function BootSplash({ wadPath }: { wadPath: string }) {
  // Render a tiny text-only "where I'm looking" indicator so users know
  // why nothing is happening if the WAD is missing. doomgeneric exits
  // the process on missing WAD so this only shows for the ~150ms init
  // window — useful for debugging though.
  return (
    <>
      <Box>booting doom…</Box>
      <Box style={{ color: 'theme:textMuted' }}>wad: {wadPath}</Box>
      <Box style={{ color: 'theme:textMuted' }}>(drop one in ~/.local/share/reactjit/wads/)</Box>
    </>
  );
}
