// One live shader thumbnail shared by Paint, material buckets, and map pickers.
// It is deliberately independent of any toolbar or panel so those surfaces can
// move without turning a preview primitive into accidental navigation chrome.
import { Box, Effect } from '../../../runtime/primitives';

export default function ShaderThumb(props: { shader: string; data: number[]; size?: number }) {
  const size = props.size ?? 40;
  return (
    <Box style={{ width: size, height: size, borderRadius: 6, overflow: 'hidden' }}>
      <Effect shader={props.shader} data={props.data} style={{ width: size, height: size }} />
    </Box>
  );
}
