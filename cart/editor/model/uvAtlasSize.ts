// Pure planning boundary for resizing the live UV atlas coordinate frame.
// The renderer and image codec perform the mutation; this module owns the
// shared limits and the exact dry-run math shown by the inspector.

// These MIRROR the host's paint-atlas law (framework/gpu/model_paint.zig:
// MAX_ATLAS_DIM = 8192, the wgpu texture-dimension ceiling; ATLAS_BUDGET = 256 MiB).
// They must not be tighter: a limit only this module believes in makes the editor
// refuse a size the painter itself just built, which is exactly the 3085x3769
// "too large" dead end (req_4743). The rest of the editor's texture surfaces
// (uvTextureWorkspace, paintAtlasCompiler) already carry the same 256 MiB figure.
export const UV_ATLAS_SIZE_TUNING = {
  minDimension: 1,
  maxDimension: 8192,
  maxRgbaBytes: 256 * 1024 * 1024,
  scaleDigits: 4,
} as const;

export type UvAtlasResizePlan = Readonly<{
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  scaleX: number;
  scaleY: number;
  targetRgbaBytes: number;
  changed: boolean;
}>;

export type UvAtlasResizeResult =
  | { ok: true; plan: UvAtlasResizePlan }
  | { ok: false; error: string };

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= UV_ATLAS_SIZE_TUNING.minDimension
    ? value
    : null;
}

export function planUvAtlasResize(
  sourceWidthValue: unknown,
  sourceHeightValue: unknown,
  targetWidthValue: unknown,
  targetHeightValue: unknown,
): UvAtlasResizeResult {
  const sourceWidth = positiveInteger(sourceWidthValue);
  const sourceHeight = positiveInteger(sourceHeightValue);
  const targetWidth = positiveInteger(targetWidthValue);
  const targetHeight = positiveInteger(targetHeightValue);
  if (sourceWidth === null || sourceHeight === null) {
    return { ok: false, error: 'The live UV atlas has invalid dimensions.' };
  }
  if (targetWidth === null || targetHeight === null) {
    return { ok: false, error: 'Width and height must be positive whole pixels.' };
  }
  if (targetWidth > UV_ATLAS_SIZE_TUNING.maxDimension
    || targetHeight > UV_ATLAS_SIZE_TUNING.maxDimension) {
    return {
      ok: false,
      error: `Width and height must not exceed ${UV_ATLAS_SIZE_TUNING.maxDimension}px.`,
    };
  }
  const targetRgbaBytes = targetWidth * targetHeight * 4;
  if (!Number.isSafeInteger(targetRgbaBytes)
    || targetRgbaBytes > UV_ATLAS_SIZE_TUNING.maxRgbaBytes) {
    return {
      ok: false,
      error: `That atlas exceeds the ${UV_ATLAS_SIZE_TUNING.maxRgbaBytes / (1024 * 1024)} MiB live UV limit.`,
    };
  }
  return {
    ok: true,
    plan: {
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      scaleX: targetWidth / sourceWidth,
      scaleY: targetHeight / sourceHeight,
      targetRgbaBytes,
      changed: sourceWidth !== targetWidth || sourceHeight !== targetHeight,
    },
  };
}

export function uvAtlasResizePreview(plan: UvAtlasResizePlan): string {
  const digits = UV_ATLAS_SIZE_TUNING.scaleDigits;
  return `X ${plan.scaleX.toFixed(digits)} · Y ${plan.scaleY.toFixed(digits)}`;
}
