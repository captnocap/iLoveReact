// editor/data/uvCoverageRaster.ts — the strict JS edge of native UV-coverage PNG
// finalization (req_3520). The host owns the large resident RGBA buffers and exact
// triangle rasterization; this module validates its compact report and proves the
// promised files actually landed before package metadata may point at them.
import { stat } from '../../../runtime/hooks/fs';

const host = globalThis as any;

export type UvCoverageSummary = {
  totalPixels: number;
  keptPixels: number;
  clearedPixels: number;
  gutterTexels: number;
  pngBytes: number;
  basePngBytes?: number;
};

export type UvCoverageRasterWrite = {
  compositePath: string;
  baselinePath?: string;
  coverage: UvCoverageSummary;
};

type NativeCoverageReport = {
  composite: number;
  baseline: number;
  w: number;
  h: number;
  totalPixels: number;
  keptPixels: number;
  clearedPixels: number;
  gutterTexels: number;
};

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum;
}

function parseCoverageReport(raw: unknown, expectedW: number, expectedH: number): NativeCoverageReport | null {
  if (typeof raw !== 'string' || !raw) return null;
  let report: Partial<NativeCoverageReport>;
  try { report = JSON.parse(raw) as Partial<NativeCoverageReport>; }
  catch { return null; }
  if (report.composite !== 1 || (report.baseline !== 0 && report.baseline !== 1)) return null;
  if (!safeInteger(report.w, 1) || !safeInteger(report.h, 1)
    || report.w !== expectedW || report.h !== expectedH) return null;
  if (!safeInteger(report.totalPixels, 1)
    || !safeInteger(report.keptPixels, 1)
    || !safeInteger(report.clearedPixels)
    || !safeInteger(report.gutterTexels)) return null;
  if (report.totalPixels !== expectedW * expectedH
    || report.keptPixels + report.clearedPixels !== report.totalPixels) return null;
  return report as NativeCoverageReport;
}

export function hasUvCoverageRasterWriter(): boolean {
  return typeof host.__model_uv_coverage_write === 'function';
}

/** Write a coverage-cleaned composite and, when requested/available, its stroke
 * baseline. null means the native door failed validation; callers may fall back
 * to the legacy base64 PNG path without ever claiming an optimization occurred. */
export function writeUvCoverageRasters(
  compositePath: string,
  baselinePath: string | null,
  width: number,
  height: number,
): UvCoverageRasterWrite | null {
  if (!hasUvCoverageRasterWriter() || !compositePath
    || !safeInteger(width, 1) || !safeInteger(height, 1)) return null;
  const report = parseCoverageReport(
    host.__model_uv_coverage_write(compositePath, baselinePath ?? ''),
    width,
    height,
  );
  if (!report) return null;
  const composite = stat(compositePath);
  if (!composite || composite.isDir) return null;
  const baseline = baselinePath && report.baseline === 1 ? stat(baselinePath) : null;
  return {
    compositePath,
    ...(baselinePath && baseline && !baseline.isDir ? { baselinePath } : {}),
    coverage: {
      totalPixels: report.totalPixels,
      keptPixels: report.keptPixels,
      clearedPixels: report.clearedPixels,
      gutterTexels: report.gutterTexels,
      pngBytes: composite.size,
      ...(baseline && !baseline.isDir ? { basePngBytes: baseline.size } : {}),
    },
  };
}
