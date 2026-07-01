// editor/inspector/ModelBrushDock.tsx — the model-paint brush's authoring dock. ONE color
// system: the brush picks colour through the SAME Color Studio (ColorStudioWorkbench) the
// material surface uses, bound to the SAME persistent colorSpine state — not BrushKit's generic
// hue-wheel, which is exactly the "conventional colour picker" the Color Studio handoff replaces
// (req_2313/2314). BrushKit stays only for the non-colour brush controls (shape / size /
// hardness / flow / blend); its colour + palette sections are hidden.
//
// The live brush is owned by the model viewer and only mirrors back here through a 2-commit
// snapshot cascade, which lagged the host <Slider>s so badly the thumbs fought every drag and
// felt dead (req_2322). So the dock edits a SYNCHRONOUS local draft — the sliders are controlled
// by immediate state (responsive) — and pushes each change out to the viewer for painting. An
// external brush change (e.g. the studio ink) is adopted, but the echo of our own edit is
// ignored so it never snaps mid-drag.
import { useEffect, useRef, useState } from 'react';
import { Col, Text } from '../../../runtime/primitives';
import { BrushKit, DARK_THEME, type Brush, type BrushTool } from '@reactjit/runtime/paint';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import type { ColorLens } from '../data/colorSpine';
import ColorStudioWorkbench from '../stage/ColorStudioWorkbench';

export type ColorSpineHandlers = {
  onSetCurrent: (color: OklchColor) => void;
  onAddToTray: () => void;
  onPickTray: (color: OklchColor) => void;
  onSetLens: (lens: ColorLens) => void;
  onSetLibraryFilter: (filter: 'match' | 'all') => void;
  onSetRampSteps: (steps: number) => void;
  onScenePick: (color: OklchColor, css: string) => void;
  onLoadLibrarySet: (colors: OklchColor[]) => void;
};

export default function ModelBrushDock(props: {
  brush: Brush;
  tool: BrushTool;
  onBrush: (b: Brush) => void;
  current: OklchColor;
  palette: OklchColor[];
  lens: ColorLens;
  libraryFilter: 'match' | 'all';
  rampSteps: number;
  scenePick: string | null;
  spine: ColorSpineHandlers;
}) {
  // Synchronous local brush so the host sliders don't lag behind the round-trip.
  const [draft, setDraft] = useState<Brush>(props.brush);
  const lastSent = useRef<string>('');

  // Adopt external brush changes (nothing we originated), but ignore the echo of our own edit
  // coming back through the snapshot — otherwise it resets the slider the instant you drag it.
  useEffect(() => {
    if (JSON.stringify(props.brush) === lastSent.current) return;
    setDraft(props.brush);
  }, [props.brush]);

  const edit = (b: Brush) => {
    lastSent.current = JSON.stringify(b);
    setDraft(b);
    props.onBrush(b);
  };

  // The brush ink mirrors the studio's current colour — one colour, everywhere. Apply through
  // the same edit path so the draft stays in sync and the stroke deposits it.
  const hex = oklchToHex(props.current);
  useEffect(() => {
    if (draft.ink.kind === 'color' && draft.ink.hex.toLowerCase() === hex.toLowerCase()) return;
    edit({ ...draft, ink: { kind: 'color', hex } });
  }, [hex]);

  return (
    <Col style={{ gap: 8, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderColor: DARK_THEME.frame }}>
      <Text style={{ color: DARK_THEME.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>BRUSH COLOR</Text>
      <ColorStudioWorkbench
        current={props.current}
        palette={props.palette}
        lens={props.lens}
        libraryFilter={props.libraryFilter}
        rampSteps={props.rampSteps}
        scenePick={props.scenePick}
        onSetCurrent={props.spine.onSetCurrent}
        onAddToTray={props.spine.onAddToTray}
        onPickTray={props.spine.onPickTray}
        onSetLens={props.spine.onSetLens}
        onSetLibraryFilter={props.spine.onSetLibraryFilter}
        onSetRampSteps={props.spine.onSetRampSteps}
        onScenePick={props.spine.onScenePick}
        onLoadLibrarySet={props.spine.onLoadLibrarySet}
      />
      <Text style={{ color: DARK_THEME.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>BRUSH</Text>
      <BrushKit
        brush={draft}
        onBrushChange={edit}
        tool={props.tool}
        onToolChange={() => { /* tool lives in the toolbar; the dock owns shape/size/flow */ }}
        palette={{ swatches: [], recents: [] }}
        theme={DARK_THEME}
        width={244}
        sections={{ tools: false, color: false, palette: false }}
      />
    </Col>
  );
}
