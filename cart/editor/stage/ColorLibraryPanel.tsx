// editor/stage/ColorLibraryPanel.tsx — THE color surface (req_2500/req_2501).
//
// The user's ruling, verbatim shape: "it should just be called the library and
// it should just show an array of the colors i like, it should have this color
// map and then i click on a color area i like, below it exposes all the same
// shit happening inside the mix and scene and ramp tab all at the same time
// because all these are doing anyways is just showing variation of the color".
//
// So: no lens tabs, no modes. ONE vertical surface —
//   CURRENT   the armed color + editable hex + save
//   SAVED     the tray (the colors you like)
//   MAP       a real 2D OKLCH picker: hue across, LIGHTNESS down (black is at
//             the bottom — the old Field only stepped hue), chroma strip below
//   then, always visible, every derivation of the current color:
//   FITS      harmony (analogous / split / complement)
//   RAMP      shadow→light steps (another road to black/white)
//   PIGMENTS  the mix dabs   ·  SCENE  what's in the scene
//   SETS      the curated groups (ring = has a color like yours)
//
// Drag handling is the ColorField pattern (runtime/paint/ColorField.tsx):
// onMouseDown/Move/Up on the Pressable itself, rect from onLayout, drag state
// in a REF so a no-move click can never wedge the surface (req_1455).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Col, Effect, Pressable, Row, Text } from '../../../runtime/primitives';
import { HexColorInput } from '../../../runtime/paint/ColorField';
import {
  hexToOklch,
  oklchToHex,
  oklchToRgb01,
  type OklchColor,
} from '../../../runtime/paint/colors';
import {
  fitsWellNow,
  libraryRows,
  mixPigments,
  oklchName,
  oklchReadout,
  rampForge,
  sceneSwatches,
} from '../data/colorSpine';

const LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', FAINT = '#6b7280';

const MAP_HEIGHT = 120;
const CHROMA_HEIGHT = 14;
const MAX_CHROMA = 0.32;
const RAMP_STEPS = 9;

// OKLCH → sRGB in-shader so the map IS the space you're picking from.
// x = hue (0..360), y = lightness (top light → BOTTOM BLACK), P[0] = chroma.
// P[1] switches the strip mode: 1 = chroma strip (x = chroma at P[2]=l, P[3]=h).
const OKLCH_MAP_SHADER = `
@group(0) @binding(1) var<storage, read> P: array<f32>;

fn oklch_rgb(l: f32, c: f32, hdeg: f32) -> vec3f {
  let hr = hdeg * 0.0174532925;
  let a = c * cos(hr);
  let b2 = c * sin(hr);
  let l_ = l + 0.3963377774 * a + 0.2158037573 * b2;
  let m_ = l - 0.1055613458 * a - 0.0638541728 * b2;
  let s_ = l - 0.0894841775 * a - 1.2914855480 * b2;
  let l3 = l_ * l_ * l_;
  let m3 = m_ * m_ * m_;
  let s3 = s_ * s_ * s_;
  var lin = vec3f(
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3);
  lin = clamp(lin, vec3f(0.0), vec3f(1.0));
  return pow(lin, vec3f(0.4545454545));
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  if (P[1] > 0.5) {
    return vec4f(oklch_rgb(P[2], in.uv.x * ${MAX_CHROMA}, P[3]), 1.0);
  }
  let hue = in.uv.x * 360.0;
  let light = 1.0 - in.uv.y;
  return vec4f(oklch_rgb(light, P[0], hue), 1.0);
}
`;

type Rect = { x: number; y: number; width: number; height: number };
const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function SectionLabel(props: { children: unknown }) {
  return <Text style={{ color: FAINT, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{props.children}</Text>;
}

function SwatchRow(props: { entries: Array<{ css: string; ring?: boolean; tooltip?: string }>; size?: number; onPick: (index: number) => void }) {
  const size = props.size ?? 22;
  return (
    <Row style={{ flexWrap: 'wrap', gap: 5 }}>
      {props.entries.map((entry, index) => (
        <Pressable
          key={`${index}-${entry.css}`}
          tooltip={entry.tooltip}
          onPress={() => props.onPick(index)}
          style={{
            width: size, height: size, borderRadius: 5, backgroundColor: entry.css,
            borderWidth: entry.ring ? 2 : 1, borderColor: entry.ring ? '#ffffff' : LINE,
          }}
        />
      ))}
    </Row>
  );
}

/**
 * The interactive part of the library deliberately owns its drag preview.
 *
 * A pointer sample is workspace-local input, not an authored color choice.  Sending every
 * sample through AppFrame used to repaint the whole editor, then update ModelView's brush,
 * then report that brush back into AppFrame for a second whole-editor pass.  Keep the marker
 * and readout live here; publish exactly one settled color when the pointer is released.
 */
function ColorMapPicker(props: {
  current: OklchColor;
  onCommit: (color: OklchColor) => void;
  onAddToTray: () => void;
  saved: ReactNode;
}) {
  const committed = props.current;
  const [preview, setPreview] = useState<OklchColor | null>(null);
  const [mapRect, setMapRect] = useState<Rect | null>(null);
  const [chromaRect, setChromaRect] = useState<Rect | null>(null);
  const dragRef = useRef<'map' | 'chroma' | null>(null);
  const liveRef = useRef(committed);
  const settledRef = useRef<OklchColor | null>(null);
  const pendingPreviewRef = useRef<OklchColor | null>(null);
  const previewFramePendingRef = useRef(false);
  const previewGenerationRef = useRef(0);

  const current = preview ?? committed;
  liveRef.current = current;

  // Pointer devices can deliver far more samples than the display can show. Coalesce local
  // marker updates to one per frame while retaining the newest sample synchronously in refs,
  // so pointer-up always commits the exact final color even before a preview frame runs.
  const queuePreview = (next: OklchColor) => {
    liveRef.current = next;
    settledRef.current = next;
    pendingPreviewRef.current = next;
    if (previewFramePendingRef.current) return;
    previewFramePendingRef.current = true;
    const generation = previewGenerationRef.current;
    const g = globalThis as any;
    const schedule: (fn: () => void) => unknown = typeof g.requestAnimationFrame === 'function'
      ? g.requestAnimationFrame.bind(g)
      : (fn) => setTimeout(fn, 16);
    schedule(() => {
      previewFramePendingRef.current = false;
      if (generation !== previewGenerationRef.current) return;
      const pending = pendingPreviewRef.current;
      if (pending) setPreview(pending);
    });
  };

  useEffect(() => () => { previewGenerationRef.current += 1; }, []);

  const pickMap = (p: any) => {
    if (!mapRect) return;
    const x = clamp01((Number(p?.x) - mapRect.x) / Math.max(1, mapRect.width));
    const y = clamp01((Number(p?.y) - mapRect.y) / Math.max(1, mapRect.height));
    queuePreview({ l: 1 - y, c: liveRef.current.c, h: x * 360 });
  };
  const pickChroma = (p: any) => {
    if (!chromaRect) return;
    const x = clamp01((Number(p?.x) - chromaRect.x) / Math.max(1, chromaRect.width));
    queuePreview({ ...liveRef.current, c: x * MAX_CHROMA });
  };
  const start = (target: 'map' | 'chroma', p: any) => {
    dragRef.current = target;
    settledRef.current = null;
    if (target === 'map') pickMap(p); else pickChroma(p);
  };
  const move = (target: 'map' | 'chroma', p: any) => {
    if (dragRef.current !== target) return;
    if (target === 'map') pickMap(p); else pickChroma(p);
  };
  const end = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    const settled = settledRef.current;
    settledRef.current = null;
    pendingPreviewRef.current = null;
    previewGenerationRef.current += 1;
    previewFramePendingRef.current = false;
    setPreview(null);
    if (settled) props.onCommit(settled);
  };

  const currentCss = oklchToHex(current);
  const committedCss = oklchToHex(committed);
  const hue = ((current.h % 360) + 360) % 360;
  const committedHue = ((committed.h % 360) + 360) % 360;
  // Preserve the exact Effect elements across preview renders. React therefore has no GPU
  // node to reconcile until a settled color actually changes one of their inputs.
  const mapEffect = useMemo(() => mapRect ? (
    <Effect shader={OKLCH_MAP_SHADER} data={[committed.c, 0, 0, 0]}
      style={{ position: 'absolute', left: 0, top: 0, width: mapRect.width, height: MAP_HEIGHT }} />
  ) : null, [mapRect?.width, committed.c]);
  const chromaEffect = useMemo(() => chromaRect ? (
    <Effect shader={OKLCH_MAP_SHADER} data={[committed.c, 1, clamp01(committed.l), committedHue]}
      style={{ position: 'absolute', left: 0, top: 0, width: chromaRect.width, height: CHROMA_HEIGHT }} />
  ) : null, [chromaRect?.width, committed.c, committed.l, committedHue]);
  const commitControls = useMemo(() => (
    <>
      <HexColorInput
        value={committedCss}
        onCommit={(hex) => props.onCommit(hexToOklch(hex))}
        showSwatch={false}
        width={104}
      />
      <Pressable tooltip="Save this color to your library" onPress={props.onAddToTray}
        style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 7, borderWidth: 1, borderColor: LINE }}>
        <Text style={{ color: TEXT, fontSize: 10, fontWeight: '700' }}>save</Text>
      </Pressable>
    </>
  ), [committedCss, props.onCommit, props.onAddToTray]);
  const markerX = mapRect ? (hue / 360) * mapRect.width - 6 : 0;
  const markerY = mapRect ? (1 - clamp01(current.l)) * MAP_HEIGHT - 6 : 0;
  const chromaX = chromaRect ? clamp01(current.c / MAX_CHROMA) * chromaRect.width - 2 : 0;

  return (
    <>
      <Row style={{ alignItems: 'center', gap: 8 }}>
        <Box style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: currentCss, borderWidth: 1, borderColor: LINE }} />
        <Col style={{ flexGrow: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} noWrap style={{ color: TEXT, fontSize: 12, fontWeight: '700' }}>{oklchName(current)}</Text>
          <Text numberOfLines={1} noWrap style={{ color: DIM, fontSize: 9, fontFamily: 'ui-monospace' }}>{oklchReadout(current)}</Text>
        </Col>
        {commitControls}
      </Row>

      {props.saved}

      <Col style={{ gap: 4 }}>
        <Pressable
          onMouseDown={(p: any) => start('map', p)}
          onMouseMove={(p: any) => move('map', p)}
          onMouseUp={end}
          onMouseLeave={end}
        >
          <Box onLayout={(r: any) => setMapRect(r)}
            style={{ height: MAP_HEIGHT, borderRadius: 8, overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: LINE }}>
            {mapEffect}
            <Box style={{ position: 'absolute', left: markerX, top: markerY, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#ffffff', backgroundColor: '#00000001' }} />
          </Box>
        </Pressable>
        <Pressable
          tooltip="Chroma — gray to vivid"
          onMouseDown={(p: any) => start('chroma', p)}
          onMouseMove={(p: any) => move('chroma', p)}
          onMouseUp={end}
          onMouseLeave={end}
        >
          <Box onLayout={(r: any) => setChromaRect(r)}
            style={{ height: CHROMA_HEIGHT, borderRadius: 5, overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: LINE }}>
            {chromaEffect}
            <Box style={{ position: 'absolute', left: chromaX, top: -1, width: 4, height: CHROMA_HEIGHT + 2, borderRadius: 2, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#0b1018' }} />
          </Box>
        </Pressable>
      </Col>
    </>
  );
}

export default function ColorLibraryPanel(props: {
  current: OklchColor;
  palette: OklchColor[];
  scenePick: string | null;
  onSetCurrent: (color: OklchColor) => void;
  onAddToTray: () => void;
  onPickTray: (color: OklchColor) => void;
  onScenePick: (color: OklchColor, css: string) => void;
  onLoadLibrarySet: (colors: OklchColor[]) => void;
}) {
  const current = props.current;
  const fits = fitsWellNow(current);
  const ramp = rampForge(current, RAMP_STEPS);
  const pigments = mixPigments();
  const scene = sceneSwatches(props.scenePick);
  const sets = libraryRows(current);

  return (
    <Col style={{ gap: 8 }}>
      {/* CURRENT + SAVED + MAP. Drag preview stays inside this small subtree. */}
      <ColorMapPicker
        current={current}
        onCommit={props.onSetCurrent}
        onAddToTray={props.onAddToTray}
        saved={props.palette.length > 0 ? (
          <Col style={{ gap: 4 }}>
            <SectionLabel>SAVED</SectionLabel>
            <SwatchRow
              entries={props.palette.map((c) => ({ css: oklchToHex(c) }))}
              onPick={(index) => props.onPickTray(props.palette[index]!)}
            />
          </Col>
        ) : null}
      />

      {/* Everything below is a VARIATION of the current color — all visible at once. */}
      <Col style={{ gap: 4 }}>
        <SectionLabel>FITS</SectionLabel>
        <SwatchRow
          entries={fits.map((f) => ({ css: f.css, tooltip: f.label }))}
          onPick={(index) => props.onSetCurrent(fits[index]!.color)}
        />
      </Col>
      <Col style={{ gap: 4 }}>
        <SectionLabel>RAMP</SectionLabel>
        <Row style={{ gap: 2 }}>
          {ramp.map((step, index) => (
            <Pressable key={index} onPress={() => props.onSetCurrent(step.color)}
              style={{ flexGrow: 1, height: 20, backgroundColor: step.css, borderWidth: 1, borderColor: LINE,
                borderTopLeftRadius: index === 0 ? 5 : 0, borderBottomLeftRadius: index === 0 ? 5 : 0,
                borderTopRightRadius: index === ramp.length - 1 ? 5 : 0, borderBottomRightRadius: index === ramp.length - 1 ? 5 : 0 }} />
          ))}
        </Row>
      </Col>
      <Row style={{ gap: 12 }}>
        <Col style={{ gap: 4 }}>
          <SectionLabel>PIGMENTS</SectionLabel>
          <SwatchRow
            entries={pigments.map((p) => ({ css: p.css, tooltip: p.name }))}
            size={20}
            onPick={(index) => props.onSetCurrent(pigments[index]!.color)}
          />
        </Col>
        <Col style={{ gap: 4, flexGrow: 1, minWidth: 0 }}>
          <SectionLabel>SCENE</SectionLabel>
          <SwatchRow
            entries={scene.map((s) => ({ css: s.css, ring: s.picked }))}
            size={20}
            onPick={(index) => props.onScenePick(scene[index]!.color, scene[index]!.css)}
          />
        </Col>
      </Row>
      <Col style={{ gap: 4 }}>
        <SectionLabel>SETS</SectionLabel>
        {sets.map((set) => (
          <Row key={set.name} style={{ alignItems: 'center', gap: 6 }}>
            <Pressable tooltip="Load this set into SAVED" onPress={() => props.onLoadLibrarySet(set.swatches.map((s) => s.color))}
              style={{ width: 92 }}>
              <Text numberOfLines={1} noWrap style={{ color: set.matched ? TEXT : DIM, fontSize: 10, fontWeight: '700' }}>{set.name}</Text>
            </Pressable>
            <SwatchRow
              entries={set.swatches.map((s) => ({ css: s.css, ring: s.isMatch }))}
              size={16}
              onPick={(index) => props.onSetCurrent(set.swatches[index]!.color)}
            />
          </Row>
        ))}
      </Col>
    </Col>
  );
}
