// runtime/paint/index.ts — the universal paint kit barrel. One import for the
// whole brush experience: data model, color math, stroke engine, themeable
// controls, the color field, and the drop-in BrushKit. The stroke controller
// + modifier hook live under runtime/hooks and are re-exported here.

export * from './model';
export * from './colors';
export * from './glyphs';
export * from './stroke';
export { stampBrushDab, brushDabRgb, jitterSeed } from './stamp';
export * from './theme';
export * from './icons';
export * from './controls';
export { ColorField, HexColorInput, type ColorFieldProps, type HexColorInputProps } from './ColorField';
export { BrushKit, type BrushKitProps } from './BrushKit';

export {
  useBrushStroke,
  type BrushStrokeOpts,
  type BrushStrokeController,
  type BrushStrokeHandlers,
  type ShapePreview,
  type MappedPoint,
  type ClipRect,
} from '../hooks/useBrushStroke';
export {
  useModifiers,
  currentModifiers,
  type Modifiers,
  type UseModifiers,
} from '../hooks/useModifiers';
