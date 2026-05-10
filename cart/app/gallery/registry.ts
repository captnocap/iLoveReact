import type { GalleryGroup, GallerySection, GallerySectionKind } from './types';
import { storySections } from './stories';
import { GALLERY_GROUPS, resolveGalleryGroup } from './taxonomy';

const GROUPS = {
  compositions: GALLERY_GROUPS.compositions,
  themes: GALLERY_GROUPS.themes,
  motion: GALLERY_GROUPS.motion,
  controls: GALLERY_GROUPS.controls,
  charts: GALLERY_GROUPS.charts,
  data: GALLERY_GROUPS.data,
  systems: GALLERY_GROUPS.systems,
} satisfies Record<string, GalleryGroup>;

type SectionMeta = {
  group: GalleryGroup;
  kind?: GallerySectionKind;
  composedOf?: string[];
};

const SECTION_META: Record<string, SectionMeta> = {
  'classifier-catalog': {
    group: GROUPS.themes,
  },
  'intent-surface': {
    group: GROUPS.compositions,
    kind: 'top-level',
    composedOf: [
      'cart/app/gallery/components/intent-surface/IntentTitle.tsx',
      'cart/app/gallery/components/intent-surface/IntentText.tsx',
      'cart/app/gallery/components/intent-surface/IntentCard.tsx',
      'cart/app/gallery/components/intent-surface/IntentRow.tsx',
      'cart/app/gallery/components/intent-surface/IntentCol.tsx',
      'cart/app/gallery/components/intent-surface/IntentList.tsx',
      'cart/app/gallery/components/intent-surface/IntentBtn.tsx',
      'cart/app/gallery/components/intent-surface/IntentBadge.tsx',
      'cart/app/gallery/components/intent-surface/IntentCode.tsx',
      'cart/app/gallery/components/intent-surface/IntentDivider.tsx',
      'cart/app/gallery/components/intent-surface/IntentKbd.tsx',
      'cart/app/gallery/components/intent-surface/IntentSpacer.tsx',
      'cart/app/gallery/components/intent-surface/types.ts',
    ],
  },
  'generic-chat-card': {
    group: GROUPS.compositions,
    kind: 'top-level',
    composedOf: [
      'cart/app/gallery/components/generic-chat-card/ConsoleHeader.tsx',
      'cart/app/gallery/components/generic-chat-card/TranscriptFlow.tsx',
      'cart/app/gallery/components/generic-chat-card/TelemetryStats.tsx',
      'cart/app/gallery/components/generic-chat-card/TaskPanel.tsx',
    ],
  },
  'braille-projection': {
    group: GROUPS.motion,
    composedOf: [
      'cart/app/gallery/components/sweatshop-matrix-display/BrailleProjectionSurface.tsx',
    ],
  },
  'model-card': { group: GROUPS.controls },
  'generic-card': { group: GROUPS.controls },
  'skeleton-tiles': { group: GROUPS.controls },
  progress: { group: GROUPS.motion },
  'circular-progress': { group: GROUPS.motion },
  tracking: { group: GROUPS.motion },
  easings: { group: GROUPS.motion },
  'animated-text': { group: GROUPS.motion },
  'grid-spinner': { group: GROUPS.motion },
  'binary-clock': { group: GROUPS.motion },
  'time-ribbons': { group: GROUPS.motion },
  'word-clock': { group: GROUPS.motion },
  'second-loom': { group: GROUPS.motion },
  'console-header': { group: GROUPS.controls },
  'transcript-flow': { group: GROUPS.controls },
  'telemetry-stats': { group: GROUPS.controls },
  'task-panel': { group: GROUPS.controls },
  chart: {
    group: GROUPS.charts,
    kind: 'top-level',
    composedOf: [
      'cart/app/gallery/components/area-chart/AreaChart.tsx',
      'cart/app/gallery/components/bar-chart/BarChart.tsx',
      'cart/app/gallery/components/boxplot/Boxplot.tsx',
      'cart/app/gallery/components/braille-graph/BrailleGraph.tsx',
      'cart/app/gallery/components/bubble-correlation/BubbleCorrelation.tsx',
      'cart/app/gallery/components/bubble-scatterplot/BubbleScatterplot.tsx',
      'cart/app/gallery/components/candlestick/Candlestick.tsx',
      'cart/app/gallery/components/circular-bar-chart/CircularBarChart.tsx',
      'cart/app/gallery/components/circular-progress/CircularProgress.tsx',
      'cart/app/gallery/components/combination-chart/CombinationChart.tsx',
      'cart/app/gallery/components/contour-map/ContourMap.tsx',
      'cart/app/gallery/components/diverging-chart/DivergingChart.tsx',
      'cart/app/gallery/components/donut-bar-chart/DonutBarChart.tsx',
      'cart/app/gallery/components/fan-chart/FanChart.tsx',
      'cart/app/gallery/components/flow-map/FlowMap.tsx',
      'cart/app/gallery/components/fraction-chart/FractionChart.tsx',
      'cart/app/gallery/components/grouped-bar-chart/GroupedBarChart.tsx',
      'cart/app/gallery/components/heatmap/Heatmap.tsx',
      'cart/app/gallery/components/layered-pyramid/LayeredPyramid.tsx',
      'cart/app/gallery/components/network-scheme/NetworkScheme.tsx',
      'cart/app/gallery/components/pictorial-fraction-chart/PictorialFractionChart.tsx',
      'cart/app/gallery/components/polar-chart/PolarChart.tsx',
      'cart/app/gallery/components/population-pyramid/PopulationPyramid.tsx',
      'cart/app/gallery/components/process-circle/ProcessCircle.tsx',
      'cart/app/gallery/components/progress/Progress.tsx',
      'cart/app/gallery/components/proportion-filters/ProportionFilters.tsx',
      'cart/app/gallery/components/pyramid-chart/PyramidChart.tsx',
      'cart/app/gallery/components/radar/Radar.tsx',
      'cart/app/gallery/components/rings-in-pie-chart/RingsInPieChart.tsx',
      'cart/app/gallery/components/scatterplot/Scatterplot.tsx',
      'cart/app/gallery/components/spline-graph/SplineGraph.tsx',
      'cart/app/gallery/components/surplus/Surplus.tsx',
      'cart/app/gallery/components/timeline/Timeline.tsx',
      'cart/app/gallery/components/tracking/Tracking.tsx',
      'cart/app/gallery/components/venn/Venn.tsx',
      'cart/app/gallery/components/waterfall-chart/WaterfallChart.tsx',
    ],
  },
  'braille-graph': { group: GROUPS.charts },
  'bar-chart': { group: GROUPS.charts },
  surplus: { group: GROUPS.charts },
  'diverging-chart': { group: GROUPS.charts },
  heatmap: { group: GROUPS.charts },
  'pictorial-fraction-chart': { group: GROUPS.charts },
  'contour-map': { group: GROUPS.charts },
  boxplot: { group: GROUPS.charts },
  scatterplot: { group: GROUPS.charts },
  'population-pyramid': { group: GROUPS.charts },
  'proportion-filters': { group: GROUPS.charts },
  'fraction-chart': { group: GROUPS.charts },
  radar: { group: GROUPS.charts },
  candlestick: { group: GROUPS.charts },
  'area-chart': { group: GROUPS.charts },
  'pyramid-chart': { group: GROUPS.charts },
  timeline: { group: GROUPS.charts },
  'combination-chart': { group: GROUPS.charts },
  'fan-chart': { group: GROUPS.charts },
  'waterfall-chart': { group: GROUPS.charts },
  'network-scheme': { group: GROUPS.charts },
  'circular-bar-chart': { group: GROUPS.charts },
  'layered-pyramid': { group: GROUPS.charts },
  'grouped-bar-chart': { group: GROUPS.charts },
  'polar-chart': { group: GROUPS.charts },
  'donut-bar-chart': { group: GROUPS.charts },
  'rings-in-pie-chart': { group: GROUPS.charts },
  'bubble-scatterplot': { group: GROUPS.charts },
  'bubble-correlation': { group: GROUPS.charts },
  'spline-graph': { group: GROUPS.charts },
  'flow-map': { group: GROUPS.charts },
  venn: { group: GROUPS.charts },
  'chart-demo-data': { group: GROUPS.data },
  'braille-effect-instrument': { group: GROUPS.motion },
  'braille-projection-surface': { group: GROUPS.motion },
};
const DEFAULT_KIND: GallerySectionKind = 'atom';

function pathExists(path: string): boolean {
  const host = globalThis as { __fs_exists?: (target: string) => boolean };
  return typeof host.__fs_exists === 'function' ? !!host.__fs_exists(path) : true;
}

function normalizeSection(section: GallerySection): GallerySection {
  const meta = SECTION_META[section.id];
  const normalized = {
    ...section,
    group: meta?.group || section.group,
    kind: section.kind || meta?.kind || DEFAULT_KIND,
    composedOf: section.composedOf || meta?.composedOf,
  };

  return {
    ...normalized,
    group: resolveGalleryGroup(normalized),
  };
}

function validateTopLevelSection(section: GallerySection) {
  if (section.kind !== 'top-level') return;

  const atoms = (section.composedOf || []).map((part) => part.trim()).filter(Boolean);
  if (atoms.length < 2) {
    throw new Error(
      `[component-gallery] top-level section "${section.id}" must declare at least two atom paths in composedOf`
    );
  }

  const sourceSet = new Set(section.stories.map((story) => story.source));
  for (const atomPath of atoms) {
    if (sourceSet.has(atomPath)) {
      throw new Error(
        `[component-gallery] top-level section "${section.id}" cannot list its own story source in composedOf`
      );
    }
    if (!pathExists(atomPath)) {
      throw new Error(
        `[component-gallery] top-level section "${section.id}" references missing atom "${atomPath}"`
      );
    }
  }
}

const normalizedSections = storySections.map(normalizeSection);
normalizedSections.forEach(validateTopLevelSection);

export const gallerySections: GallerySection[] = normalizedSections;
