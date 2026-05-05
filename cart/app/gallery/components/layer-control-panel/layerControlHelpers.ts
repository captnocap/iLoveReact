import type { LayerBlendMode, LayerKind } from '../../data/overstock/layer-control-panel';
import type { ControlTone } from '../controls-specimen/controlsSpecimenTheme';

const blendShort: Record<LayerBlendMode, string> = {
  Normal: 'NORM',
  Multiply: 'MULT',
  Screen: 'SCRN',
  Overlay: 'OVLY',
};

const kindLabel: Record<LayerKind, string> = {
  pixel: 'PIXEL',
  group: 'GROUP',
  adjustment: 'ADJ',
  type: 'TYPE',
  mask: 'MASK',
  smart: 'SMART',
};

const kindTone: Record<LayerKind, ControlTone> = {
  pixel: 'blue',
  group: 'accent',
  adjustment: 'warn',
  type: 'ink',
  mask: 'ok',
  smart: 'lilac',
};

export function getBlendShort(mode: LayerBlendMode): string {
  return blendShort[mode];
}

export function getLayerKindLabel(kind: LayerKind): string {
  return kindLabel[kind];
}

export function getLayerKindTone(kind: LayerKind): ControlTone {
  return kindTone[kind];
}
