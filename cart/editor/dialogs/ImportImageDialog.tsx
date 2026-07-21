// editor/dialogs/ImportImageDialog.tsx — the image-import decision dialog.
//
// One image, two storage forms, side by side with REAL previews and measured
// numbers — the user picks by looking, not by knowing formats:
//   PIXEL TEXTURE  the quantized palette form (tiny, recolorable). Preview is
//                  the actual PIXEL_TEXTURE_SHADER render of the actual probe.
//   EXACT IMAGE    the original bytes copied once into the project. Preview is
//                  the host image loader on the source file.
// The measured winner is pre-selected: quantization error decides (flat art
// scores near 0; photos and anti-aliased text score high — exactly the "don't
// store text this way" instinct, made mechanical).
import { Box, Row, Col, Text, Pressable, Effect, Image } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { PIXEL_TEXTURE_SHADER, packPixelTexture, type QuantizeProbe } from '../textures/pixelTexture';

const POP = '#17181b', LINE = '#2a2c31', TEXT = '#e8e8ea', DIM = '#9a9ea6', ACCENT = '#6ea8fe', GOOD = '#6ee7a8';

// Above this mean-squared error the quantized form visibly degrades (banding /
// chewed glyph edges) and the exact copy becomes the recommendation.
const PIXEL_MSE_CEILING = 900;
// The probe downsamples to 128 on the longest side (the shader data[] budget),
// so the pixel form can lose resolution AND cost more bytes than a well-packed
// original (indexed PNGs of flat art beat JSON RLE) — req_3028: never recommend
// the form that is worse on BOTH axes.

export type ImportImagePlan = {
  sourcePath: string;
  name: string;
  probe: QuantizeProbe;
  /** decoded source dims + on-disk size of the original */
  sourceWidth: number;
  sourceHeight: number;
  sourceKb: number;
  /** serialized pixel payload size */
  pixelKb: number;
};

export default function ImportImageDialog(props: {
  plan: ImportImagePlan;
  onPick: (form: 'pixel' | 'exact') => void;
  onCancel: () => void;
}) {
  const { plan } = props;
  const downsampled = plan.probe.width < plan.sourceWidth || plan.probe.height < plan.sourceHeight;
  const recommendPixel = plan.probe.mse <= PIXEL_MSE_CEILING && !(downsampled && plan.pixelKb >= plan.sourceKb);
  const previewData = packPixelTexture(plan.probe);

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable onPress={props.onCancel} hoverStyle={{}} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }} />
      <Col style={{ width: 620, backgroundColor: POP, borderWidth: 1, borderColor: LINE, borderRadius: 14, padding: 16, gap: 12 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="Image" size={14} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 14, fontWeight: '700' }}>Import {plan.name}</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{plan.sourceWidth}x{plan.sourceHeight} · {plan.sourceKb} KB on disk</Text>
        </Row>
        <Row style={{ gap: 12 }}>
          <FormCard
            title="Pixel texture"
            recommended={recommendPixel}
            statLines={[
              `${plan.probe.colors} colors · ${plan.probe.width}x${plan.probe.height}${downsampled ? ` — DOWNSAMPLED from ${plan.sourceWidth}x${plan.sourceHeight}` : ''}`,
              `${plan.pixelKb} KB · recolorable${plan.pixelKb >= plan.sourceKb ? ' — LARGER than the original' : ''}`,
              `fit error ${Math.round(plan.probe.mse)}${plan.probe.mse <= PIXEL_MSE_CEILING ? ' (clean)' : ' (visible loss)'}`,
            ]}
            onPress={() => props.onPick('pixel')}
          >
            <Effect shader={PIXEL_TEXTURE_SHADER} data={previewData} style={{ width: 256, height: 256 }} />
          </FormCard>
          <FormCard
            title="Exact image"
            recommended={!recommendPixel}
            statLines={[
              `${plan.sourceWidth}x${plan.sourceHeight} original pixels`,
              `${plan.sourceKb} KB · copied into the project`,
              'no color slots',
            ]}
            onPress={() => props.onPick('exact')}
          >
            <Image src={plan.sourcePath} style={{ width: 256, height: 256 }} />
          </FormCard>
        </Row>
        <Row style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Pressable onPress={props.onCancel} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: LINE }}>
            <Text style={{ color: DIM, fontSize: 12, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}

function FormCard(props: {
  title: string;
  recommended: boolean;
  statLines: string[];
  onPress: () => void;
  children: unknown;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        flexGrow: 1, flexDirection: 'column', gap: 8, padding: 10, borderRadius: 12,
        borderWidth: 2, borderColor: props.recommended ? ACCENT : LINE, backgroundColor: '#0f1012',
      }}
    >
      <Row style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{ color: TEXT, fontSize: 12, fontWeight: '700' }}>{props.title}</Text>
        {props.recommended ? <Text style={{ color: GOOD, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>RECOMMENDED</Text> : null}
      </Row>
      <Box style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d0e10', borderRadius: 8, padding: 6 }}>
        {props.children}
      </Box>
      {props.statLines.map((line) => (
        <Text key={line} style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{line}</Text>
      ))}
    </Pressable>
  );
}
