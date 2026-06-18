// editors/model/Backdrops.tsx — reference-image backdrops for tracing (req_1280).
//
// Drop a blueprint / concept / photo into the Studio viewport on one of the six
// cardinal planes, behind the model, then build straight over it — the classic
// "blueprint on the walls" modeling setup. Each backdrop is a thin translucent
// quad rendered through Scene3D's image-texture path (an offscreen StaticSurface
// the mesh samples via `textureKey`, the SAME mechanism the sprite atlas uses, see
// TextureAtlas.tsx), so the grid + model read through it as you orbit.
//
// Backdrops are TWIG (working state): they survive a hot reload but reset on a
// cold restart, like the scale ghost / mirror planes — a tracing aid, not model
// data. See [[feedback_studio_branch_twig_cold_hot]].

import { memo, useState } from 'react';
import { Box, Col, Image, Pressable, Row, Slider, StaticSurface, Text, TextInput } from '@reactjit/primitives';
import { mesh, type GeometryData } from '@reactjit/geometries';
import { run } from '@reactjit/hooks/process';
import { GAME_CHROME } from '../../game';

const T = GAME_CHROME.tokens.color;

// The plane a backdrop lives on. front/back = the XY walls (a front/rear blueprint
// standing on the floor); left/right = the ZY walls (a side blueprint); top/bottom =
// the XZ floor plan, laid flat for a plan/footprint trace.
export type BackdropPlane = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface Backdrop {
  id: string;
  name: string;
  /** an <Image> source — a `data:` URL (small) or a content-addressed cache path
   *  (large), exactly what the texture importer produces (texSource). */
  source: string;
  /** image width / height, so the quad keeps the picture's proportions (no stretch). */
  aspect: number;
  plane: BackdropPlane;
  /** the longer side of the quad, in METERS (1 tile = 1 m, matching the world). */
  scale: number;
  /** free WORLD position of the quad's CENTER (m). The transform gizmo drags this
   *  (req_1285) — you place the trace where it lines up with your view instead of
   *  fighting plane presets. Seeded from the plane preset on add/orient. */
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
 *  the grid. The gizmo moves it from here. */
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

export const BACKDROP_KEY_PREFIX = 'studio.backdrop.';
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
  // so the transform gizmo moves the quad by editing pos, never the geometry.
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

// ── Image dimensions (pure JS, no codec ingredient) ───────────────────────────
// Read width/height straight from PNG (IHDR) or JPEG (SOFn) headers so the quad
// keeps the picture's proportions WITHOUT depending on the gated imageops door —
// this stays pure TSX, hot-reloadable, no rebuild.
export function imageDims(bytes: Uint8Array): { w: number; h: number } | null {
  if (!bytes || bytes.length < 24) return null;
  // PNG — signature 0x89 'PNG', width/height are bytes 16..24 (big-endian).
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const w = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    const h = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    return w > 0 && h > 0 ? { w, h } : null;
  }
  // JPEG — scan markers for a Start-Of-Frame (SOFn) segment carrying the size.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      // standalone markers (no length payload): padding, RSTn, SOI/EOI.
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6];
        const w = (bytes[i + 7] << 8) | bytes[i + 8];
        return w > 0 && h > 0 ? { w, h } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

// ── The setup panel ───────────────────────────────────────────────────────────
// A modal for adding/positioning backdrops. Setup only — close it and the planes
// stay in the viewport while you model. Controls are native Sliders (SLIDER-0611).

const BTN = { paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a' } as const;

function SliderRow(props: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (n: number) => void }) {
  return (
    <Row style={{ alignItems: 'center', gap: 8 }}>
      <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace', width: 52 }}>{props.label}</Text>
      <Box style={{ flexGrow: 1 }}>
        <Slider value={props.value} min={props.min} max={props.max} step={props.step} onChange={props.onChange} />
      </Box>
      <Text fontSize={10} color={T.text} style={{ fontFamily: 'monospace', width: 50, textAlign: 'right' }}>
        {`${props.value.toFixed(props.step < 1 ? 2 : 1)}${props.suffix ?? ''}`}
      </Text>
    </Row>
  );
}

export function BackdropsPanel(props: {
  backdrops: Backdrop[];
  activeId: string | null;
  onAdd: (path: string) => void;
  onUpdate: (id: string, patch: Partial<Backdrop>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string) => void;
  onClose: () => void;
}) {
  const { backdrops } = props;
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#03060caa' }}>
      <Col style={{ width: 540, maxHeight: '86%', gap: 12, padding: 16, borderRadius: 10, backgroundColor: T.panelSolid, borderWidth: 1, borderColor: '#2c4a6a' }}>
        <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Text fontSize={13} color={T.text} style={{ fontWeight: '800' }}>Reference Backdrops</Text>
          <Pressable onPress={props.onClose} style={BTN}><Text fontSize={11} color={T.dim}>Done</Text></Pressable>
        </Row>
        <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace' }}>
          drop a PNG/JPEG, hit Move, then drag the gizmo to line it up · scroll = orbit · 1 m = 1 tile
        </Text>

        <AddRow onAdd={props.onAdd} />

        <Col style={{ gap: 10 }}>
          {backdrops.length === 0 ? (
            <Text fontSize={11} color={T.dim} style={{ fontStyle: 'italic' }}>no backdrops yet — add a reference image above.</Text>
          ) : backdrops.map((bd) => (
            <Col key={bd.id} style={{ gap: 7, padding: 10, borderRadius: 8, backgroundColor: T.page, borderWidth: 1, borderColor: bd.visible ? '#2c4a6a' : '#22303f' }}>
              <Row style={{ alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text fontSize={11} color={T.text} style={{ fontFamily: 'monospace', flexShrink: 1 }} numberOfLines={1}>{bd.name}</Text>
                <Row style={{ gap: 6, alignItems: 'center' }}>
                  <Pressable onPress={() => props.onMove(bd.id)} tooltip="Move — drag the transform gizmo in the viewport to position this backdrop (Esc to drop)" style={{ ...BTN, backgroundColor: props.activeId === bd.id ? '#3a2f5e' : '#16324a', borderColor: props.activeId === bd.id ? '#9b7fd6' : '#4a7fb0' }}>
                    <Text fontSize={10} color={props.activeId === bd.id ? '#e0d4ff' : '#9fcfff'} style={{ fontWeight: '800' }}>✥ move</Text>
                  </Pressable>
                  <Pressable onPress={() => props.onUpdate(bd.id, { visible: !bd.visible })} tooltip="Show / hide this backdrop" style={{ ...BTN, backgroundColor: bd.visible ? '#1c3a2a' : '#13233aee', borderColor: bd.visible ? '#2f7a4f' : '#2c4a6a' }}>
                    <Text fontSize={10} color={bd.visible ? '#7fd6a0' : T.dim}>{bd.visible ? '◉ shown' : '○ hidden'}</Text>
                  </Pressable>
                  <Pressable onPress={() => props.onUpdate(bd.id, { flipU: !bd.flipU })} tooltip="Mirror left↔right" style={{ ...BTN, backgroundColor: bd.flipU ? '#241c3a' : '#13233aee', borderColor: bd.flipU ? '#6b54a6' : '#2c4a6a' }}>
                    <Text fontSize={10} color={bd.flipU ? '#cdbcff' : T.dim}>⇄ flip</Text>
                  </Pressable>
                  <Pressable onPress={() => props.onRemove(bd.id)} tooltip="Remove this backdrop" style={{ ...BTN, backgroundColor: '#2a1414', borderColor: '#7a2f2f' }}>
                    <Text fontSize={10} color="#f0a0a0">✕</Text>
                  </Pressable>
                </Row>
              </Row>
              {/* orientation picker — re-orients the quad AND re-seats it to that
                  plane's default spot (then the gizmo nudges it from there). */}
              <Row style={{ gap: 4, flexWrap: 'wrap' }}>
                {BACKDROP_PLANES.map((pl) => {
                  const on = bd.plane === pl.key;
                  return (
                    <Pressable key={pl.key} onPress={() => props.onUpdate(bd.id, { plane: pl.key, pos: defaultBackdropPos(pl.key) })} tooltip={pl.hint} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 4, backgroundColor: on ? '#1c3a5a' : 'transparent', borderWidth: 1, borderColor: on ? '#4a7fb0' : '#2c4a6a' }}>
                      <Text fontSize={10} color={on ? '#9fcfff' : T.dim} style={{ fontWeight: on ? '800' : '400' }}>{pl.label}</Text>
                    </Pressable>
                  );
                })}
              </Row>
              <SliderRow label="size" value={bd.scale} min={0.5} max={20} step={0.1} suffix="m" onChange={(n) => props.onUpdate(bd.id, { scale: n })} />
              <SliderRow label="opacity" value={bd.opacity} min={0.05} max={1} step={0.05} onChange={(n) => props.onUpdate(bd.id, { opacity: n })} />
            </Col>
          ))}
        </Col>
      </Col>
    </Box>
  );
}

// Open the desktop's NATIVE file-open window and return the chosen path. Driven
// through the process door (has-process) with `zenity` — the GTK picker present on
// GNOME/Budgie. Returns { path } on pick, { cancelled } on cancel, or
// { unavailable } when no picker binary is on PATH (so the UI can fall back to a
// typed path). No rebuild — this is the same subprocess door useAssistant uses.
async function pickImageFile(): Promise<{ path?: string; cancelled?: boolean; unavailable?: boolean }> {
  try {
    const res = await run('zenity', [
      '--file-selection',
      '--title=Choose a reference image',
      '--file-filter=Images | *.png *.jpg *.jpeg *.webp *.gif *.bmp *.PNG *.JPG *.JPEG',
      '--file-filter=All files | *',
    ]);
    if (res.code === 0) { const p = res.stdout.trim(); return p ? { path: p } : { cancelled: true }; }
    // pid===0 → run() yields code -1 + 'spawn failed'; zenity cancel → code 1.
    if (res.code < 0 || /spawn failed/i.test(res.stderr)) return { unavailable: true };
    return { cancelled: true };
  } catch {
    return { unavailable: true };
  }
}

function AddRow(props: { onAdd: (path: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // reveal the manual path field only when the native picker isn't available, so
  // the common case is one click and no typing.
  const [manual, setManual] = useState(false);

  const browse = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('opening file window…');
    const r = await pickImageFile();
    setBusy(false);
    if (r.path) { setStatus(''); props.onAdd(r.path); }
    else if (r.unavailable) { setStatus('no file dialog found — paste a path below'); setManual(true); }
    else setStatus('');
  };

  return (
    <Col style={{ gap: 7 }}>
      <Row style={{ gap: 8, alignItems: 'center' }}>
        <Pressable onPress={browse} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8, borderRadius: 6, backgroundColor: busy ? '#13233aee' : '#16324a', borderWidth: 1, borderColor: '#4a7fb0' }}>
          <Text fontSize={12} color="#9fcfff" style={{ fontWeight: '800' }}>{busy ? '⏳ choosing…' : '🖼  Choose image…'}</Text>
        </Pressable>
        {status ? <Text fontSize={10} color={T.dim} style={{ fontFamily: 'monospace', flexShrink: 1 }}>{status}</Text> : null}
        {!manual ? (
          <Pressable onPress={() => setManual(true)} tooltip="Type a file path instead" style={{ marginLeft: 'auto' }}>
            <Text fontSize={10} color={T.dim}>or paste a path</Text>
          </Pressable>
        ) : null}
      </Row>
      {manual ? <PathInput onAdd={props.onAdd} /> : null}
    </Col>
  );
}

function PathInput(props: { onAdd: (path: string) => void }) {
  const [path, setPath] = useState('');
  const add = () => { const p = path.trim(); if (p) { props.onAdd(p); setPath(''); } };
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Box style={{ flexGrow: 1 }}>
        <TextInput value={path} onChangeText={setPath} placeholder="path to a PNG/JPEG reference…" style={{ height: 26, fontSize: 11, color: T.ink, backgroundColor: T.page, borderWidth: 1, borderColor: '#2c4a6a', borderRadius: 4, paddingHorizontal: 8, fontFamily: 'monospace' }} />
      </Box>
      <Pressable onPress={add} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 6, paddingBottom: 6, borderRadius: 6, backgroundColor: '#16324a', borderWidth: 1, borderColor: '#4a7fb0' }}>
        <Text fontSize={11} color="#9fcfff" style={{ fontWeight: '800' }}>+ Add</Text>
      </Pressable>
    </Row>
  );
}
