// editor/inspector/ModelBrushDock.tsx — the model-paint brush's authoring dock. ONE color
// system: the brush picks colour through the SAME Color Studio (ColorStudioWorkbench) the
// material surface uses, bound to the SAME persistent colorSpine state — not BrushKit's generic
// hue-wheel, which is exactly the "conventional colour picker" the Color Studio handoff replaces
// (req_2313/2314). BrushKit stays only for the non-colour brush controls (shape / size /
// hardness / flow / blend); its colour + palette sections are hidden. The brush's ink is a live
// mirror of the studio's current colour, so painting a face and authoring a material share one
// colour + one palette.
import { useEffect } from 'react';
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
  // The brush ink mirrors the studio's current colour — one colour, everywhere. When the studio
  // colour changes, push it onto the brush (as hex) so the paint stroke deposits it. Guarded so
  // it only fires on a real change.
  const hex = oklchToHex(props.current);
  useEffect(() => {
    if (props.brush.ink.kind === 'color' && props.brush.ink.hex.toLowerCase() === hex.toLowerCase()) return;
    props.onBrush({ ...props.brush, ink: { kind: 'color', hex } });
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
        brush={props.brush}
        onBrushChange={props.onBrush}
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
