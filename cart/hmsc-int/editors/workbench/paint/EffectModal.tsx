// editors/workbench/paint/EffectModal.tsx — the custom-WGSL FX modal
// (CUTOUTFLIP-0606: extracted verbatim from the retired /cutout route —
// AGNOSTICPAINT parity row E2, deferral 2 closed). Name · WGSL editor ·
// live/stale preview; "apply preview" recompiles the draft shader, "add"
// registers it in the painter's FX gallery and points the active layer at
// it. Drafts twig under /workbench so half-written shaders survive route
// hops and hot updates.

import { Box, Col, Row, Text, TextArea, TextInput } from '@reactjit/runtime/primitives';
import { GAME_CHROME } from '../../../game/chrome';
import { PaintQuad, type PaintEditorState } from '../../paint';
import { useRouteTwigState } from '../../twigs';

const { Chip } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;

const CUSTOM_FX_TEMPLATE = `@group(0) @binding(1) var<storage, read> data: array<f32>;

fn maskAt(uv: vec2f) -> f32 {
  let gw = data[0];
  let gh = data[1];
  let igw = u32(gw);
  let igh = u32(gh);
  let xi = u32(floor(uv.x * gw));
  let yi = u32(floor(uv.y * gh));
  let cx = min(xi, igw - 1u);
  let cy = min(yi, igh - 1u);
  return data[8u + cy * igw + cx];
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let m = maskAt(in.uv);
  if (m < 0.5) { return vec4f(0.0); }

  let p = in.uv * 2.0 - vec2f(1.0);
  let r = length(p);
  let bands = 0.5 + 0.5 * sin(r * 24.0 - U.time * 3.0);
  let hue = fract(0.58 + bands * 0.18 + U.time * 0.04);
  let color = hsv2rgb(hue, 0.85, 1.0);
  return vec4f(color, data[2]);
}`;

const MODAL_PREVIEW_GRID = 18;
const MODAL_PREVIEW_CELLS = (() => {
  const cells = new Set<number>();
  for (let i = 0; i < MODAL_PREVIEW_GRID * MODAL_PREVIEW_GRID; i++) cells.add(i);
  return cells;
})();

export function EffectModal({ s, onClose }: { s: PaintEditorState; onClose: () => void }) {
  const [label, setLabel] = useRouteTwigState('/workbench', 'fxDraftLabel', `Custom ${s.customSurfaces.length + 1}`);
  const [shader, setShader] = useRouteTwigState('/workbench', 'fxDraftShader', CUSTOM_FX_TEMPLATE);
  const [previewShader, setPreviewShader] = useRouteTwigState('/workbench', 'fxPreviewShader', CUSTOM_FX_TEMPLATE);
  const previewStale = shader !== previewShader;
  const add = () => {
    const id = s.addCustomSurface(label.trim() || 'Custom FX', shader);
    s.setLayerMode(s.activeLayer, id);
    onClose();
  };
  return (
    <Box style={{
      position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 90,
      backgroundColor: '#050812cc', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <Col style={{
        width: 760, height: 520, borderRadius: 10, overflow: 'hidden',
        backgroundColor: T.panelSolid, borderWidth: 1, borderColor: T.frame,
      }}>
        <Row style={{ height: 44, paddingHorizontal: 14, alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: T.frame }}>
          <Text style={{ color: T.ink, fontSize: 12, fontWeight: '900' }}>New FX</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: previewStale ? T.warn : T.dim, fontSize: 10, fontWeight: '800' }}>
            {previewStale ? 'preview stale' : 'preview live'}
          </Text>
        </Row>
        <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, padding: 14, gap: 12 }}>
          <Col style={{ width: 400, gap: 8, minHeight: 0 }}>
            <Text style={{ color: T.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>NAME</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              style={{
                height: 28, fontSize: 12, color: T.ink, backgroundColor: T.control,
                borderWidth: 1, borderColor: T.frame, borderRadius: 5, paddingHorizontal: 8,
              }}
            />
            <Text style={{ color: T.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>SHADER (WGSL)</Text>
            <Box style={{
              flexGrow: 1, flexBasis: 0, minHeight: 0, borderRadius: 6,
              borderWidth: 1, borderColor: T.frame, backgroundColor: T.page, overflow: 'hidden',
            }}>
              <TextArea
                value={shader}
                onChangeText={setShader}
                fontSize={11}
                color={T.ink}
                style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, padding: 10, color: T.ink, fontFamily: 'monospace' }}
              />
            </Box>
          </Col>
          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }}>
            <Text style={{ color: T.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>PREVIEW</Text>
            <Box style={{
              flexGrow: 1, flexBasis: 0, minHeight: 0, borderRadius: 6, position: 'relative',
              borderWidth: 1, borderColor: T.frame, backgroundColor: T.page, overflow: 'hidden',
            }}>
              <PaintQuad
                cells={MODAL_PREVIEW_CELLS}
                gridSize={MODAL_PREVIEW_GRID}
                worldW={300}
                worldH={400}
                dim={1}
                mode="custom:draft"
                customSurfaces={[{ id: 'custom:draft', label: 'draft', shader: previewShader }]}
              />
            </Box>
          </Col>
        </Row>
        <Row style={{ height: 48, paddingHorizontal: 14, alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: T.frame }}>
          <Text style={{ color: T.dim, fontSize: 10 }}>Apply preview to recompile · Add commits to the FX gallery</Text>
          <Box style={{ flexGrow: 1 }} />
          <Chip label="cancel" color="dim" onPress={onClose} />
          <Chip label="apply preview" color={previewStale ? 'warn' : 'dim'} onPress={() => setPreviewShader(shader)} />
          <Chip label="add" color="good" onPress={add} />
        </Row>
      </Col>
    </Box>
  );
}
