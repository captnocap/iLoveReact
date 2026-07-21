// One live shader thumbnail shared by Paint, material buckets, and map pickers.
// It is deliberately independent of any toolbar or panel so those surfaces can
// move without turning a preview primitive into accidental navigation chrome.
import { memo } from 'react';
import { Box, Effect } from '../../../runtime/primitives';

export type ShaderThumbProps = { shader: string; data: readonly number[]; size?: number };

/** Shader data builders return fresh arrays during parent renders. Compare the
 *  values so unchanged previews do not emit Effect updates and invalidate an
 *  enclosing StaticSurface cache. */
export function sameShaderThumbProps(a: ShaderThumbProps, b: ShaderThumbProps): boolean {
  if (a.shader !== b.shader || (a.size ?? 40) !== (b.size ?? 40) || a.data.length !== b.data.length) return false;
  for (let index = 0; index < a.data.length; index += 1) {
    if (!Object.is(a.data[index], b.data[index])) return false;
  }
  return true;
}

function ShaderThumb(props: ShaderThumbProps) {
  const size = props.size ?? 40;
  return (
    <Box style={{ width: size, height: size, borderRadius: 6, overflow: 'hidden' }}>
      <Effect shader={props.shader} data={props.data} style={{ width: size, height: size }} />
    </Box>
  );
}

export default memo(ShaderThumb, sameShaderThumbProps);
