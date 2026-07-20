// Canonical colour-blend math for CPU paint backends. Inputs are linearized only
// by convention today (the editor stores sRGB bytes); keeping the vocabulary in
// one pure module prevents model/facade tools from inventing different modes.
import type { BlendMode } from './model';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** The fully-applied blend target for one unpremultiplied colour channel. */
export function blendChannel(destination: number, source: number, mode: BlendMode): number {
  const d = clamp01(destination);
  const s = clamp01(source);
  switch (mode) {
    case 'multiply': return d * s;
    case 'screen': return 1 - (1 - d) * (1 - s);
    case 'overlay': return d <= 0.5 ? 2 * d * s : 1 - 2 * (1 - d) * (1 - s);
    case 'add': return Math.min(1, d + s);
    case 'subtract': return Math.max(0, d - s);
    case 'darken': return Math.min(d, s);
    case 'lighten': return Math.max(d, s);
    case 'normal':
    case 'erase':
    default: return s;
  }
}

/** Source-over one channel where the destination byte is already premultiplied. */
export function compositeBlendChannel(
  destinationPremultiplied: number,
  destinationAlpha: number,
  source: number,
  sourceAlpha: number,
  mode: BlendMode,
): number {
  const da = clamp01(destinationAlpha);
  const sa = clamp01(sourceAlpha);
  const dp = clamp01(destinationPremultiplied);
  const destination = da > 0 ? clamp01(dp / da) : 0;
  const target = blendChannel(destination, source, mode);
  return clamp01(target * sa + dp * (1 - sa));
}
