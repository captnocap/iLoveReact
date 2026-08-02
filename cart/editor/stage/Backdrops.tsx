// editor/stage/Backdrops.tsx — reference-image backdrops for tracing (req_2758).
//
// Drop a blueprint / concept / photo into the model viewport on one of the six cardinal
// planes, behind the model, then build straight over it — the classic "blueprint on the
// walls" modeling setup. Each backdrop is a thin translucent quad rendered through
// Scene3D's image-texture path (an offscreen StaticSurface the quad samples via
// `textureKey`), so the stage grid + model read through it as you orbit.
//
// Backdrops are TWIG (working state): they survive reloads via localstore but are a
// tracing aid, never model data — they don't ride the model package.

import { memo } from 'react';
import { Box, Col, Image, Pressable, Row, Slider, StaticSurface, Text } from '@reactjit/runtime/primitives';
import { mesh, type GeometryData } from '@reactjit/geometries';
import { base64ToBytes } from '@reactjit/workspace';
import { pickFile } from '@reactjit/runtime/hooks/pickFile';
import { exists, mkdir, readFileBase64, writeFileBase64Atomic } from '@reactjit/runtime/hooks/fs';
import { nsGet, nsSet } from '@reactjit/runtime/hooks/localstore';

// The plane a backdrop lives on. front/back = the XY walls (a front/rear blueprint
// standing on the floor); left/right = the ZY walls (a side blueprint); top/bottom =
// the XZ floor plan, laid flat for a plan/footprint trace.
export type BackdropPlane = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface Backdrop {
  id: string;
  name: string;
  /** an <Image> source — a `data:` URL (small) or a content-addressed cache path (large). */
  source: string;
  /** image width / height, so the quad keeps the picture's proportions (no stretch). */
  aspect: number;
  plane: BackdropPlane;
  /** the longer side of the quad, in METERS (1 tile = 1 m, matching the stage). */
  scale: number;
  /** WORLD position of the quad's CENTER (m) — the panel's X/Y/Z sliders drive this. */
  pos: [number, number, number];
  /** how see-through the trace is (0..1) — low so the model reads over it. */
  opacity: number;
  /** mirror left↔right (a side blueprint shot from the wrong side). */
  flipU: boolean;
  visible: boolean;
}

export const BACKDROP_PLANES: { key: BackdropPlane; label: string; hint: string }[] = [
  { key: 'front', label: 'Front', hint: 'XY wall · faces the +Z camera' },
  { key: 'back', label: 'Back', hint: 'XY wall · rear view' },
  { key: 'left', label: 'Left', hint: 'ZY wall · side view (−X)' },
  { key: 'right', label: 'Right', hint: 'ZY wall · side view (+X)' },
  { key: 'top', label: 'Top', hint: 'XZ floor · plan view' },
  { key: 'bottom', label: 'Bottom', hint: 'XZ floor · underside' },
];

/** A sensible starting CENTER for a freshly-oriented backdrop: vertical walls stand
 *  ~1 m up and sit 1.4 m out (clear of a model at origin); floor plans lie just off
 *  the grid. The panel's position sliders move it from here. */
export function defaultBackdropPos(plane: BackdropPlane): [number, number, number] {
  switch (plane) {
    case 'front': return [0, 1, -1.4];
    case 'back': return [0, 1, 1.4];
    case 'left': return [-1.4, 1, 0];
    case 'right': return [1.4, 1, 0];
    case 'top': return [0, 0.02, 0];
    default: return [0, -0.02, 0];
  }
}

// ── Texture surface (offscreen) ───────────────────────────────────────────────
// Each backdrop renders its image into its OWN StaticSurface (a unique staticKey)
// at the picture's native aspect, capped so a huge source doesn't blow VRAM. The
// quad samples it 0..1, so surface-aspect == quad-aspect == image-aspect → no
// stretch. memo'd on (id, source) so it re-bakes only when the picture changes.

export const BACKDROP_KEY_PREFIX = 'editor.backdrop.';
export const backdropTexKey = (id: string): string => BACKDROP_KEY_PREFIX + id;

/** the largest side a backdrop surface is rasterized at — plenty to trace against
 *  without holding a full-res scan on the GPU. */
export const BACKDROP_PX = 1024;
export function backdropPx(aspect: number): { w: number; h: number } {
  if (!Number.isFinite(aspect) || aspect <= 0) return { w: BACKDROP_PX, h: BACKDROP_PX };
  return aspect >= 1
    ? { w: BACKDROP_PX, h: Math.max(1, Math.round(BACKDROP_PX / aspect)) }
    : { w: Math.max(1, Math.round(BACKDROP_PX * aspect)), h: BACKDROP_PX };
}

export const BackdropSurface = memo(function BackdropSurface(props: { id: string; source: string; aspect: number }) {
  const { w, h } = backdropPx(props.aspect);
  return (
    <StaticSurface staticKey={backdropTexKey(props.id)} style={{ position: 'absolute', left: -99999, top: 0, width: w, height: h }}>
      <Image source={props.source} style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }} />
    </StaticSurface>
  );
});

// ── Quad geometry ─────────────────────────────────────────────────────────────
// A DOUBLE-SIDED quad (both windings) so the trace never vanishes when you orbit
// behind it — the 3D pipeline back-face-culls, so a single face would drop out.
// UVs follow the geometries face() convention (V flipped → picture upright).

type V3 = readonly [number, number, number];
type UV = readonly [number, number];

function quadDims(aspect: number, scale: number): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return a >= 1 ? { w: scale, h: scale / a } : { w: scale * a, h: scale };
}

function pushDoubleQuad(m: ReturnType<typeof mesh>, BL: V3, BR: V3, TR: V3, TL: V3, n: V3, uv: { bl: UV; br: UV; tr: UV; tl: UV }): void {
  const nb: V3 = [-n[0], -n[1], -n[2]];
  // front (CCW from +n)
  m.vert(BL, n, uv.bl); m.vert(BR, n, uv.br); m.vert(TR, n, uv.tr);
  m.vert(BL, n, uv.bl); m.vert(TR, n, uv.tr); m.vert(TL, n, uv.tl);
  // back (reversed winding, −n) — visible from the far side
  m.vert(BL, nb, uv.bl); m.vert(TR, nb, uv.tr); m.vert(BR, nb, uv.br);
  m.vert(BL, nb, uv.bl); m.vert(TL, nb, uv.tl); m.vert(TR, nb, uv.tr);
}

export function backdropQuad(bd: Backdrop): GeometryData {
  const { w, h } = quadDims(bd.aspect, bd.scale);
  // Centered at the ORIGIN — world placement comes from the mesh `position` (bd.pos),
  // so the position sliders move it without a geometry re-bake.
  const uv = bd.flipU
    ? { bl: [1, 1] as UV, br: [0, 1] as UV, tr: [0, 0] as UV, tl: [1, 0] as UV }
    : { bl: [0, 1] as UV, br: [1, 1] as UV, tr: [1, 0] as UV, tl: [0, 0] as UV };
  const m = mesh();
  const hw = w / 2, hh = h / 2;
  if (bd.plane === 'front' || bd.plane === 'back') {
    // XY plane, normal +Z, centered.
    pushDoubleQuad(m, [-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0], [0, 0, 1], uv);
  } else if (bd.plane === 'left' || bd.plane === 'right') {
    // ZY plane, normal +X; width runs along Z, height along Y.
    pushDoubleQuad(m, [0, -hh, -hw], [0, -hh, hw], [0, hh, hw], [0, hh, -hw], [1, 0, 0], uv);
  } else {
    // XZ plane, normal +Y; width→X, height→Z (picture "up" = −Z).
    pushDoubleQuad(m, [-hw, 0, hh], [hw, 0, hh], [hw, 0, -hh], [-hw, 0, -hh], [0, 1, 0], uv);
  }
  return m.build();
}

// ── Image dimensions (pure JS, no codec door) ──────────────────────────────────
// Read width/height straight from PNG (IHDR) or JPEG (SOFn) headers so the quad
// keeps the picture's proportions without the gated imageops door.
export function imageDims(bytes: Uint8Array): { w: number; h: number } | null {
  if (!bytes || bytes.length < 24) return null;
  // PNG — signature 0x89 'PNG', width/height are bytes 16..24 (big-endian).
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const w = ((bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!) >>> 0;
    const h = ((bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!) >>> 0;
    return w > 0 && h > 0 ? { w, h } : null;
  }
  // JPEG — scan markers for a Start-Of-Frame (SOFn) segment carrying the size.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1]!;
      // standalone markers (no length payload): padding, RSTn, SOI/EOI.
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        const h = (bytes[i + 5]! << 8) | bytes[i + 6]!;
        const w = (bytes[i + 7]! << 8) | bytes[i + 8]!;
        return w > 0 && h > 0 ? { w, h } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

// ── Source lowering (the studio's inline/cache split) ─────────────────────────
// Small images ride INLINE as a data: URL; large ones are copied to a content-
// addressed cache file and referenced by PATH — keeping big pictures out of the
// localstore twig (the 4MB value cap is a hard wall). The hash in the filename
// makes the path change with content, so a re-picked file never goes stale.
const INLINE_MAX_BYTES = 256 * 1024;
const CACHE_DIR = 'cart/editor/.cache';

const fnvHex = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

const mimeFor = (path: string): string => {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/png';
};

function refSource(b64: string, srcPath: string): string {
  const approxBytes = Math.floor(b64.length * 0.75);
  if (approxBytes <= INLINE_MAX_BYTES) return `data:${mimeFor(srcPath)};base64,${b64}`;
  mkdir(CACHE_DIR);
  const ext = (srcPath.split('.').pop() || 'png').toLowerCase();
  const path = `${CACHE_DIR}/ref_${fnvHex(b64)}.${ext}`;
  if (!exists(path)) writeFileBase64Atomic(path, b64);
  return path;
}

// ── Twig persistence (localstore; a tracing aid, never model data) ────────────
const NS = 'editor';
// Keyed PER DOCUMENT (req_3621): the old single 'model-backdrops' key made every trace
// plane a permanent global — open ANY model and someone else's translucent reference
// quads haunted the viewport with nothing on screen explaining where they came from.
// A backdrop is working state for the model it was traced against, nothing else.
const KEY_PREFIX = 'model-backdrops';
const storeKey = (docId: string) => `${KEY_PREFIX}:${docId}`;

export function loadBackdrops(docId: string | null): Backdrop[] {
  if (!docId) return [];
  try {
    const raw = nsGet(NS, storeKey(docId));
    const list = raw ? (JSON.parse(raw) as Backdrop[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export function saveBackdrops(docId: string | null, list: Backdrop[]): void {
  if (!docId) return;
  try { nsSet(NS, storeKey(docId), JSON.stringify(list)); } catch { /* over-cap saves fail loud in localstore */ }
}

// each new backdrop lands on the next plane in this cycle so a front/side/top set
// auto-distributes onto different walls (the sliders nudge from there).
const PLANE_CYCLE: BackdropPlane[] = ['front', 'left', 'top', 'back', 'right', 'bottom'];
let g_bd_seq = 0;

/** Load a reference image off disk into a Backdrop, or a string error (loud, honest). */
export function backdropFromPath(rawPath: string, existingCount: number): Backdrop | string {
  const path = rawPath.trim();
  if (!path) return 'no path';
  if (!exists(path)) return `not found: ${path}`;
  const b64 = readFileBase64(path);
  if (!b64) return `could not read: ${path}`;
  const dims = imageDims(base64ToBytes(b64));
  const aspect = dims ? dims.w / dims.h : 1;
  const plane = PLANE_CYCLE[existingCount % PLANE_CYCLE.length]!;
  g_bd_seq += 1;
  const name = (path.split('/').pop() || path).slice(0, 40);
  return {
    id: `bd_${fnvHex(b64)}_${g_bd_seq}`,
    name, source: refSource(b64, path), aspect,
    plane, scale: 4, pos: defaultBackdropPos(plane), opacity: 0.5, flipU: false, visible: true,
  };
}

// ── The setup panel ───────────────────────────────────────────────────────────
// A floating card (loop-cut styling) for adding/positioning backdrops. Setup only —
// close it and the planes stay in the viewport while you model; the viewport (orbit,
// select, gizmo) stays live behind it so you can line the trace up as you tune.

const CARD_BG = 'rgba(11,19,32,0.96)';
const EDGE = '#2c4a6a';
const EDGE_SOFT = '#22303f';
const TXT = '#e6eefb';
const DIM = '#8fa1b8';
const FIELD_BG = '#16233aee';
const ON_BG = '#244164';
const ON_EDGE = '#4e75a4';

function SliderRow(props: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (n: number) => void }) {
  return (
    <Row style={{ alignItems: 'center', gap: 8 }}>
      <Text numberOfLines={1} noWrap style={{ color: DIM, fontSize: 10, fontFamily: 'monospace', width: 52 }}>{props.label}</Text>
      <Box style={{ flexGrow: 1 }}>
        <Slider value={props.value} min={props.min} max={props.max} step={props.step} onChange={props.onChange} />
      </Box>
      <Text numberOfLines={1} noWrap style={{ color: TXT, fontSize: 10, fontFamily: 'monospace', width: 50, textAlign: 'right' }}>
        {`${props.value.toFixed(props.step < 1 ? 2 : 1)}${props.suffix ?? ''}`}
      </Text>
    </Row>
  );
}

const CHIP = { paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 5, borderWidth: 1 } as const;

export function BackdropsPanel(props: {
  backdrops: Backdrop[];
  onUpdate: (id: string, patch: Partial<Backdrop>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
  status: string | null;
  // one backdrop's controls expanded at a time — the card stays a card, not a wall.
  // CONTROLLED by the viewer (req_3080): the expanded backdrop is the one wearing the
  // in-viewport move gizmo, so the owner of that session owns this too.
  openId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const { openId, onOpen: setOpenId } = props;
  return (
    <Box style={{ position: 'absolute', right: 10, top: 44, bottom: 62, width: 340, overflow: 'hidden' }}>
      <Col style={{ maxHeight: '100%', padding: 12, gap: 10, borderRadius: 8, backgroundColor: CARD_BG, borderWidth: 1, borderColor: EDGE }}>
        <Row style={{ alignItems: 'center' }}>
          <Text numberOfLines={1} noWrap style={{ color: TXT, fontSize: 13, fontWeight: 700, flexGrow: 1, minWidth: 0 }}>Reference Images</Text>
          <Pressable onPress={props.onAdd} tooltip="Add a reference image (native file window)" style={{ ...CHIP, backgroundColor: '#1c3a2a', borderColor: '#2f7a4f', marginRight: 6 }}>
            <Text style={{ color: '#7fd6a0', fontSize: 11, fontWeight: 700 }}>+ Add</Text>
          </Pressable>
          <Pressable onPress={props.onClose} tooltip="Close — the planes stay in the viewport" style={{ ...CHIP, backgroundColor: '#303747', borderColor: '#566176' }}>
            <Text style={{ color: '#b9c4d4', fontSize: 11 }}>✕</Text>
          </Pressable>
        </Row>
        {props.status ? (
          <Text numberOfLines={2} style={{ color: '#f0b090', fontSize: 10, fontFamily: 'monospace' }}>{props.status}</Text>
        ) : null}
        {props.backdrops.length === 0 ? (
          <Text style={{ color: DIM, fontSize: 11 }}>no reference images yet — Add drops one on a wall behind the model.</Text>
        ) : null}
        <Col style={{ gap: 8, overflow: 'scroll', flexShrink: 1 }}>
          {props.backdrops.map((bd) => {
            const open = openId === bd.id;
            return (
              <Col key={bd.id} style={{ gap: 7, padding: 9, borderRadius: 7, backgroundColor: '#0d1626', borderWidth: 1, borderColor: bd.visible ? EDGE : EDGE_SOFT }}>
                <Row style={{ alignItems: 'center', gap: 6 }}>
                  <Pressable onPress={() => setOpenId(open ? null : bd.id)} tooltip={open ? 'Collapse' : 'Expand controls'} style={{ flexGrow: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} noWrap style={{ color: TXT, fontSize: 11, fontFamily: 'monospace' }}>{`${open ? '▾' : '▸'} ${bd.name}`}</Text>
                  </Pressable>
                  <Pressable onPress={() => props.onUpdate(bd.id, { visible: !bd.visible })} tooltip="Show / hide this backdrop" style={{ ...CHIP, backgroundColor: bd.visible ? '#1c3a2a' : FIELD_BG, borderColor: bd.visible ? '#2f7a4f' : EDGE }}>
                    <Text style={{ color: bd.visible ? '#7fd6a0' : DIM, fontSize: 10 }}>{bd.visible ? '◉' : '○'}</Text>
                  </Pressable>
                  <Pressable onPress={() => props.onUpdate(bd.id, { flipU: !bd.flipU })} tooltip="Mirror left↔right (a side blueprint shot from the wrong side)" style={{ ...CHIP, backgroundColor: bd.flipU ? '#241c3a' : FIELD_BG, borderColor: bd.flipU ? '#6b54a6' : EDGE }}>
                    <Text style={{ color: bd.flipU ? '#cdbcff' : DIM, fontSize: 10 }}>⇄</Text>
                  </Pressable>
                  <Pressable onPress={() => props.onRemove(bd.id)} tooltip="Remove this backdrop" style={{ ...CHIP, backgroundColor: '#2a1414', borderColor: '#7a2f2f' }}>
                    <Text style={{ color: '#f0a0a0', fontSize: 10 }}>✕</Text>
                  </Pressable>
                </Row>
                {open ? (
                  <Col style={{ gap: 6 }}>
                    {/* orientation picker — re-orients the quad AND re-seats it to that
                        plane's default spot (the sliders nudge it from there). */}
                    <Row style={{ gap: 4, flexWrap: 'wrap' }}>
                      {BACKDROP_PLANES.map((pl) => {
                        const on = bd.plane === pl.key;
                        return (
                          <Pressable key={pl.key} onPress={() => props.onUpdate(bd.id, { plane: pl.key, pos: defaultBackdropPos(pl.key) })} tooltip={pl.hint} style={{ ...CHIP, backgroundColor: on ? ON_BG : 'transparent', borderColor: on ? ON_EDGE : EDGE }}>
                            <Text style={{ color: on ? '#9fcfff' : DIM, fontSize: 10, fontWeight: on ? 700 : 400 }}>{pl.label}</Text>
                          </Pressable>
                        );
                      })}
                    </Row>
                    {/* Position sliders are GONE (req_3080, USER: "the xyz pos blows
                        chunks") — the expanded backdrop wears the move gizmo in the
                        viewport; drag its arms to place the image. Size + opacity stay. */}
                    <SliderRow label="size" value={bd.scale} min={0.5} max={20} step={0.1} suffix="m" onChange={(n) => props.onUpdate(bd.id, { scale: n })} />
                    <SliderRow label="opacity" value={bd.opacity} min={0.05} max={1} step={0.05} onChange={(n) => props.onUpdate(bd.id, { opacity: n })} />
                  </Col>
                ) : null}
              </Col>
            );
          })}
        </Col>
      </Col>
    </Box>
  );
}

/** Open the native image picker and lower the pick into a Backdrop (or a loud error). */
export async function pickBackdrop(existingCount: number): Promise<Backdrop | string | null> {
  const path = await pickFile({
    title: 'Choose a reference image',
    filters: [
      { name: 'Images', patterns: ['*.png', '*.jpg', '*.jpeg', '*.webp', '*.gif', '*.bmp', '*.PNG', '*.JPG', '*.JPEG'] },
      { name: 'All files', patterns: ['*'] },
    ],
  });
  if (!path) return null; // cancelled
  return backdropFromPath(path, existingCount);
}
