// editor/inspector/ModelBrushDock.tsx — the model-paint brush's authoring dock. ONE color
// system: the brush picks colour through the SAME Color Library (ColorLibraryPanel) the
// material surface uses, bound to the SAME persistent colorSpine state — not BrushKit's generic
// hue-wheel, which is exactly the "conventional colour picker" the Color Studio handoff replaces
// (req_2313/2314). BrushKit stays only for the non-colour brush controls (shape / size /
// hardness / flow / blend); its colour + palette sections are hidden.
//
// Performance shape (req_2365): the live brush lives in the VIEWER, and syncing to it costs a
// full editor re-render + a whole-state persist. Doing that per slider-move dropped 240fps → 0.
// So the dials live in an ISOLATED child (BrushDials) with a local draft: dragging re-renders
// only that child — never the sibling Color Studio (whose WGSL field would re-bake) — and it
// syncs out to the viewer ONLY on release (onBrushCommit), off the hot path. Discrete controls
// (shape/blend chips) commit immediately since they don't drag.
import { useEffect, useRef, useState } from 'react';
import { Col, Text } from '../../../runtime/primitives';
import { BrushKit, DARK_THEME, type Brush, type BrushTool } from '@reactjit/runtime/paint';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import ColorLibraryPanel from '../stage/ColorLibraryPanel';
import ModelShaderBucket from './ModelShaderBucket';

export type ColorSpineHandlers = {
  onSetCurrent: (color: OklchColor) => void;
  onAddToTray: () => void;
  onPickTray: (color: OklchColor) => void;
  onScenePick: (color: OklchColor, css: string) => void;
  onLoadLibrarySet: (colors: OklchColor[]) => void;
};

// The dials, isolated. Owns a synchronous local draft so sliders are responsive, and its
// re-renders never touch the Color Studio sibling. Syncs to the viewer only on commit.
export function BrushDials(props: { seed: Brush; tool: BrushTool; inkHex?: string; width?: number; onSync: (b: Brush) => void }) {
  const [draft, setDraft] = useState<Brush>(props.seed);
  const lastSync = useRef<string>('');

  // Adopt an external brush change (rare), ignoring the echo of our own committed edit.
  useEffect(() => {
    if (JSON.stringify(props.seed) === lastSync.current) return;
    setDraft(props.seed);
  }, [props.seed]);

  const sync = (b: Brush) => { lastSync.current = JSON.stringify(b); props.onSync(b); };

  // Studio colour (low frequency — a click) flows into the brush ink and syncs immediately.
  useEffect(() => {
    if (!props.inkHex) return;
    if (draft.ink.kind === 'color' && draft.ink.hex.toLowerCase() === props.inkHex.toLowerCase()) return;
    const nb: Brush = { ...draft, ink: { kind: 'color', hex: props.inkHex } };
    setDraft(nb);
    sync(nb);
  }, [props.inkHex]);

  return (
    <BrushKit
      brush={draft}
      onBrushChange={setDraft}                       // live: LOCAL only, no viewer round-trip
      onBrushCommit={(b) => { setDraft(b); sync(b); }} // settled: sync to the viewer once
      tool={props.tool}
      onToolChange={() => { /* tool lives in the toolbar; the dock owns shape/size/flow */ }}
      palette={{ swatches: [], recents: [] }}
      theme={DARK_THEME}
      width={props.width ?? 244}
      sections={{ tools: false, color: false, palette: false }}
    />
  );
}

export default function ModelBrushDock(props: {
  brush: Brush;
  tool: BrushTool;
  onBrush: (b: Brush) => void;
  current: OklchColor;
  palette: OklchColor[];
  scenePick: string | null;
  spine: ColorSpineHandlers;
  paletteFor?: (specId: string, variant: number) => [number, number, number][] | null;
}) {
  return (
    <Col style={{ gap: 8, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderColor: DARK_THEME.frame }}>
      <Text style={{ color: DARK_THEME.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>BRUSH COLOR</Text>
      <ColorLibraryPanel
        current={props.current}
        palette={props.palette}
        scenePick={props.scenePick}
        onSetCurrent={props.spine.onSetCurrent}
        onAddToTray={props.spine.onAddToTray}
        onPickTray={props.spine.onPickTray}
        onScenePick={props.spine.onScenePick}
        onLoadLibrarySet={props.spine.onLoadLibrarySet}
      />
      <Text style={{ color: DARK_THEME.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>BRUSH</Text>
      <BrushDials seed={props.brush} tool={props.tool} inkHex={oklchToHex(props.current)} onSync={props.onBrush} />
      {/* Paint-with-a-shader: dip the brush into a shader bucket instead of the flat colour above.
          Selecting a bucket sets a shader ink (surface + tuned params); "colour" hands the brush
          back to the Color Studio's current colour. */}
      <ModelShaderBucket brush={props.brush} onBrush={props.onBrush} colorHex={oklchToHex(props.current)} paletteFor={props.paletteFor} />
    </Col>
  );
}
