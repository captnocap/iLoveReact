// editor/inspector/ModelBrushDock.tsx — the shared brush kit, docked in the Model Focus
// panel while paint mode is active. This is the ONE brush system (runtime/paint) — the same
// BrushKit Color Studio, MaterialFocus, brush_studio and the Studio pixel-painter mount. The
// model surface stays bland; the tool / face-safety / detail toggles live in the top toolbar,
// so this dock hides the tools section and owns only the brush: colour wheel, size/hardness/
// flow dials, blend, and the palette. It's a controlled view of the viewer's brush state —
// changes flow back through the model tool api (onBrush / onPalette) so the viewer stays the
// single owner of the live brush.
import { Col, Text } from '../../../runtime/primitives';
import { BrushKit, DARK_THEME, type Brush, type BrushTool, type Palette } from '@reactjit/runtime/paint';

export default function ModelBrushDock(props: {
  brush: Brush;
  palette: Palette;
  tool: BrushTool;
  onBrush: (b: Brush) => void;
  onPalette: (p: Palette) => void;
}) {
  return (
    <Col style={{ gap: 8, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderColor: DARK_THEME.frame }}>
      <Text style={{ color: DARK_THEME.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>BRUSH</Text>
      <BrushKit
        brush={props.brush}
        onBrushChange={props.onBrush}
        tool={props.tool}
        onToolChange={() => { /* tool lives in the toolbar; the dock owns the brush only */ }}
        palette={props.palette}
        onPaletteChange={props.onPalette}
        theme={DARK_THEME}
        width={244}
        sections={{ tools: false }}
      />
    </Col>
  );
}
