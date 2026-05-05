import type { GalleryDataReference, JsonObject } from '../../types';
import { PALETTE } from '../lib/chart-palette';

function objectSchema(properties: Record<string, JsonObject>, required: string[] = Object.keys(properties)): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function arraySchema(items: JsonObject): JsonObject {
  return {
    type: 'array',
    items,
  };
}

const stringSchema: JsonObject = { type: 'string' };
const numberSchema: JsonObject = { type: 'number' };
const booleanSchema: JsonObject = { type: 'boolean' };
const stringArraySchema = arraySchema(stringSchema);
const numberArraySchema = arraySchema(numberSchema);

export const DEMO_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DEMO_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
export const DEMO_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const DEMO_REVENUE = [45, 52, 48, 61, 58, 72, 68, 75, 82, 79, 88, 95];
export const DEMO_MARGIN = [12, 14, 11, 16, 15, 18, 17, 19, 21, 20, 22, 24];
export const DEMO_RESPONSE_TIME = [45, 52, 38, 61, 55, 42, 48];
export const DEMO_TEMPERATURE = [18, 19, 22, 25, 28, 32, 35, 34, 30, 26, 21, 19];

export type OhlcDatum = { o: number; h: number; l: number; c: number };
export const DEMO_OHLC: OhlcDatum[] = [
  { o: 142.5, h: 145.2, l: 140.8, c: 144.1 },
  { o: 144.1, h: 146.8, l: 142.3, c: 143.5 },
  { o: 143.5, h: 148.0, l: 141.5, c: 147.2 },
  { o: 147.2, h: 149.5, l: 145.0, c: 148.8 },
  { o: 148.8, h: 150.2, l: 146.5, c: 149.5 },
  { o: 149.5, h: 151.8, l: 147.2, c: 150.1 },
  { o: 150.1, h: 152.5, l: 148.0, c: 151.4 },
  { o: 151.4, h: 153.0, l: 149.5, c: 152.2 },
];

export type BubbleDatum = { x: number; y: number; r: number };
export const DEMO_CAMPAIGNS: BubbleDatum[] = [
  { x: 1200, y: 45, r: 3.2 },
  { x: 2400, y: 82, r: 2.8 },
  { x: 800, y: 28, r: 2.1 },
  { x: 3600, y: 110, r: 2.5 },
  { x: 1800, y: 62, r: 2.9 },
  { x: 4200, y: 135, r: 2.4 },
  { x: 600, y: 18, r: 2.0 },
  { x: 3000, y: 95, r: 2.7 },
];

export const DEMO_CORRELATION: BubbleDatum[] = [
  { x: 1.2, y: 15, r: 8 },
  { x: 1.8, y: 22, r: 10 },
  { x: 2.5, y: 35, r: 12 },
  { x: 3.1, y: 48, r: 14 },
  { x: 1.5, y: 18, r: 9 },
  { x: 2.8, y: 42, r: 13 },
  { x: 3.5, y: 58, r: 16 },
  { x: 2.2, y: 30, r: 11 },
];

export const DEMO_HEATMAP = [
  [0.2, 0.5, 0.8, 0.3, 0.9, 0.4, 0.7, 0.1],
  [0.6, 0.2, 0.4, 0.8, 0.5, 0.9, 0.3, 0.7],
  [0.9, 0.7, 0.1, 0.5, 0.2, 0.6, 0.8, 0.4],
  [0.3, 0.9, 0.6, 0.2, 0.7, 0.1, 0.5, 0.8],
  [0.5, 0.3, 0.9, 0.7, 0.4, 0.8, 0.2, 0.6],
  [0.8, 0.6, 0.2, 0.9, 0.3, 0.5, 0.7, 0.1],
  [0.4, 0.8, 0.5, 0.1, 0.6, 0.9, 0.3, 0.7],
];

export type WaterfallDatum = { label: string; value: number };
export const DEMO_WATERFALL: WaterfallDatum[] = [
  { label: 'Revenue', value: 850 },
  { label: 'COGS', value: -420 },
  { label: 'Gross', value: 430 },
  { label: 'R&D', value: -120 },
  { label: 'Marketing', value: -95 },
  { label: 'Ops', value: -65 },
  { label: 'Net', value: 150 },
];

export type BoxplotDatum = { label: string; min: number; q1: number; median: number; q3: number; max: number };
export const DEMO_BOXPLOT: BoxplotDatum[] = [
  { label: 'NA', min: 25, q1: 42, median: 58, q3: 78, max: 120 },
  { label: 'EU', min: 30, q1: 48, median: 65, q3: 88, max: 140 },
  { label: 'APAC', min: 55, q1: 85, median: 110, q3: 145, max: 210 },
  { label: 'LATAM', min: 40, q1: 62, median: 82, q3: 108, max: 160 },
];

export type RadarDatum = { axis: string; a: number; b: number };
export const DEMO_RADAR: RadarDatum[] = [
  { axis: 'Speed', a: 0.85, b: 0.65 },
  { axis: 'Reliability', a: 0.7, b: 0.9 },
  { axis: 'Price', a: 0.55, b: 0.75 },
  { axis: 'Features', a: 0.9, b: 0.6 },
  { axis: 'Support', a: 0.75, b: 0.8 },
  { axis: 'UX', a: 0.8, b: 0.7 },
];

export const DEMO_POP_LABELS = ['0-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61+'];
export const DEMO_POP_LEFT = [8.2, 12.5, 18.3, 22.1, 19.8, 15.2, 10.5];
export const DEMO_POP_RIGHT = [7.8, 11.9, 17.5, 21.8, 20.5, 16.8, 13.2];

export type SentimentDatum = { label: string; value: number };
export const DEMO_SENTIMENT: SentimentDatum[] = [
  { label: 'Shipping', value: 72 },
  { label: 'Pricing', value: -35 },
  { label: 'Quality', value: 58 },
  { label: 'Support', value: -18 },
  { label: 'UX', value: 45 },
  { label: 'Speed', value: -12 },
];

export type TimelineDatum = { label: string; status: 'done' | 'active' | 'pending' };
export const DEMO_TIMELINE: TimelineDatum[] = [
  { label: 'Kickoff', status: 'done' },
  { label: 'Design', status: 'done' },
  { label: 'Prototype', status: 'done' },
  { label: 'Beta', status: 'active' },
  { label: 'Launch', status: 'pending' },
];

export type TrackingDatum = { label: string; done: boolean };
export const DEMO_TRACKING: TrackingDatum[] = [
  { label: 'Ordered', done: true },
  { label: 'Packed', done: true },
  { label: 'Shipped', done: true },
  { label: 'In Transit', done: true },
  { label: 'Delivered', done: false },
];

export type DonutDatum = { label: string; value: number; color?: string };
export const DEMO_BUDGET: DonutDatum[] = [
  { label: 'R&D', value: 35, color: PALETTE.pink },
  { label: 'Marketing', value: 25, color: PALETTE.cyan },
  { label: 'Ops', value: 20, color: PALETTE.blue },
  { label: 'Sales', value: 20, color: PALETTE.purple },
];

export type FanDatum = { label: string; base: number; upper: number; lower: number };
export const DEMO_FAN: FanDatum[] = [
  { label: 'Jan', base: 45, upper: 52, lower: 38 },
  { label: 'Feb', base: 52, upper: 60, lower: 44 },
  { label: 'Mar', base: 48, upper: 55, lower: 41 },
  { label: 'Apr', base: 61, upper: 70, lower: 52 },
  { label: 'May', base: 58, upper: 67, lower: 49 },
  { label: 'Jun', base: 72, upper: 83, lower: 61 },
];

export type PyramidDatum = { label: string; value: number; color?: string };
export const DEMO_PYRAMID: PyramidDatum[] = [
  { label: 'Enterprise', value: 10, color: PALETTE.pink },
  { label: 'Pro', value: 25, color: PALETTE.cyan },
  { label: 'Basic', value: 40, color: PALETTE.blue },
];

export const DEMO_SURPLUS = [12, 19, 15, 25, 22, 30, 28, 35, 32, 40, 38, 45];

export type NetworkNode = { x: number; y: number; r: number; label: string; color?: string };
export type NetworkEdge = [number, number];

export const DEMO_NETWORK_NODES: NetworkNode[] = [
  { x: 140, y: 30, r: 8, label: 'API', color: PALETTE.pink },
  { x: 80, y: 80, r: 6, label: 'Auth', color: PALETTE.cyan },
  { x: 200, y: 80, r: 6, label: 'DB', color: PALETTE.cyan },
  { x: 50, y: 140, r: 5, label: 'Cache', color: PALETTE.blue },
  { x: 120, y: 150, r: 5, label: 'Queue', color: PALETTE.blue },
  { x: 190, y: 140, r: 5, label: 'Worker', color: PALETTE.blue },
  { x: 230, y: 130, r: 5, label: 'Store', color: PALETTE.blue },
];

export const DEMO_NETWORK_EDGES: NetworkEdge[] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [1, 4],
  [2, 4],
  [2, 5],
  [2, 6],
  [4, 5],
];

export type FlowNode = { x: number; y: number; r: number; label: string };
export type FlowEdge = { from: number; to: number };

export const DEMO_FLOW_NODES: FlowNode[] = [
  { x: 60, y: 100, r: 6, label: 'Src' },
  { x: 150, y: 60, r: 5, label: 'Proc' },
  { x: 160, y: 130, r: 5, label: 'Filter' },
  { x: 250, y: 80, r: 6, label: 'Merge' },
  { x: 260, y: 130, r: 5, label: 'Out' },
];

export const DEMO_FLOW_EDGES: FlowEdge[] = [
  { from: 0, to: 1 },
  { from: 0, to: 2 },
  { from: 1, to: 3 },
  { from: 2, to: 4 },
  { from: 3, to: 4 },
];

export type RingsDatum = { inner: number; outer: number; data: DonutDatum[] };
export const DEMO_RINGS: RingsDatum[] = [
  {
    outer: 80,
    inner: 65,
    data: [
      { label: 'Direct', value: 40, color: PALETTE.pink },
      { label: 'Social', value: 35, color: PALETTE.cyan },
      { label: 'Organic', value: 25, color: PALETTE.blue },
    ],
  },
  {
    outer: 60,
    inner: 45,
    data: [
      { label: 'US', value: 50, color: PALETTE.purple },
      { label: 'EU', value: 30, color: PALETTE.teal },
      { label: 'APAC', value: 20, color: PALETTE.indigo },
    ],
  },
  {
    outer: 40,
    inner: 25,
    data: [
      { label: 'New', value: 60, color: PALETTE.pinkLight },
      { label: 'Returning', value: 40, color: PALETTE.cyanLight },
    ],
  },
];

export type VennDatum = { label: string; cx: number; cy: number; r: number; color: string; size: number };
export const DEMO_VENN: VennDatum[] = [
  { label: 'Mobile', cx: 95, cy: 90, r: 45, color: PALETTE.pink, size: 35 },
  { label: 'Desktop', cx: 145, cy: 90, r: 45, color: PALETTE.cyan, size: 28 },
  { label: 'Tablet', cx: 120, cy: 110, r: 45, color: PALETTE.blue, size: 22 },
];

export type ProportionDatum = { cx: number; cy: number; r: number; label: string; color: string };
export const DEMO_PROPORTIONS: ProportionDatum[] = [
  { cx: 60, cy: 80, r: 35, label: '35%', color: PALETTE.pink },
  { cx: 150, cy: 60, r: 25, label: '25%', color: PALETTE.cyan },
  { cx: 200, cy: 110, r: 18, label: '18%', color: PALETTE.blue },
  { cx: 110, cy: 120, r: 12, label: '12%', color: PALETTE.purple },
];

export type ContourDatum = { cx: number; cy: number; rx: number; ry: number; name: string };
export const DEMO_CONTOURS: ContourDatum[] = [
  { cx: 100, cy: 80, rx: 15, ry: 10, name: 'Peak A' },
  { cx: 100, cy: 80, rx: 30, ry: 20, name: 'Peak A' },
  { cx: 100, cy: 80, rx: 45, ry: 30, name: 'Peak A' },
  { cx: 100, cy: 80, rx: 60, ry: 40, name: 'Peak A' },
  { cx: 180, cy: 110, rx: 12, ry: 8, name: 'Peak B' },
  { cx: 180, cy: 110, rx: 25, ry: 16, name: 'Peak B' },
  { cx: 180, cy: 110, rx: 38, ry: 24, name: 'Peak B' },
  { cx: 140, cy: 60, rx: 10, ry: 7, name: 'Peak C' },
  { cx: 140, cy: 60, rx: 22, ry: 14, name: 'Peak C' },
  { cx: 140, cy: 60, rx: 34, ry: 21, name: 'Peak C' },
];

export type ChartDemoData = {
  months: string[];
  quarters: string[];
  days: string[];
  revenue: number[];
  profitMargin: number[];
  responseTime: number[];
  temperature: number[];
  ohlc: OhlcDatum[];
  campaignData: BubbleDatum[];
  correlationData: BubbleDatum[];
  heatmap: number[][];
  waterfall: WaterfallDatum[];
  boxplot: BoxplotDatum[];
  radar: RadarDatum[];
  popLabels: string[];
  popLeft: number[];
  popRight: number[];
  sentiment: SentimentDatum[];
  timelineEvents: TimelineDatum[];
  trackingSteps: TrackingDatum[];
  budget: DonutDatum[];
  forecastBand: FanDatum[];
  pyramidSegments: PyramidDatum[];
  surplus: number[];
  networkNodes: NetworkNode[];
  networkEdges: NetworkEdge[];
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  rings: RingsDatum[];
  venn: VennDatum[];
  proportions: ProportionDatum[];
  contours: ContourDatum[];
};

const bubbleDatumSchema = objectSchema({
  x: numberSchema,
  y: numberSchema,
  r: numberSchema,
});

const ohlcDatumSchema = objectSchema({
  o: numberSchema,
  h: numberSchema,
  l: numberSchema,
  c: numberSchema,
});

const waterfallDatumSchema = objectSchema({
  label: stringSchema,
  value: numberSchema,
});

const boxplotDatumSchema = objectSchema({
  label: stringSchema,
  min: numberSchema,
  q1: numberSchema,
  median: numberSchema,
  q3: numberSchema,
  max: numberSchema,
});

const radarDatumSchema = objectSchema({
  axis: stringSchema,
  a: numberSchema,
  b: numberSchema,
});

const sentimentDatumSchema = objectSchema({
  label: stringSchema,
  value: numberSchema,
});

const timelineDatumSchema = objectSchema({
  label: stringSchema,
  status: {
    type: 'string',
    enum: ['done', 'active', 'pending'],
  },
});

const trackingDatumSchema = objectSchema({
  label: stringSchema,
  done: booleanSchema,
});

const donutDatumSchema = objectSchema({
  label: stringSchema,
  value: numberSchema,
  color: stringSchema,
});

const fanDatumSchema = objectSchema({
  label: stringSchema,
  base: numberSchema,
  upper: numberSchema,
  lower: numberSchema,
});

const pyramidDatumSchema = objectSchema({
  label: stringSchema,
  value: numberSchema,
  color: stringSchema,
});

const networkNodeSchema = objectSchema({
  x: numberSchema,
  y: numberSchema,
  r: numberSchema,
  label: stringSchema,
  color: stringSchema,
});

const networkEdgeSchema: JsonObject = {
  type: 'array',
  items: numberSchema,
  minItems: 2,
  maxItems: 2,
};

const flowNodeSchema = objectSchema({
  x: numberSchema,
  y: numberSchema,
  r: numberSchema,
  label: stringSchema,
});

const flowEdgeSchema = objectSchema({
  from: numberSchema,
  to: numberSchema,
});

const ringsDatumSchema = objectSchema({
  inner: numberSchema,
  outer: numberSchema,
  data: arraySchema(donutDatumSchema),
});

const vennDatumSchema = objectSchema({
  label: stringSchema,
  cx: numberSchema,
  cy: numberSchema,
  r: numberSchema,
  color: stringSchema,
  size: numberSchema,
});

const proportionDatumSchema = objectSchema({
  cx: numberSchema,
  cy: numberSchema,
  r: numberSchema,
  label: stringSchema,
  color: stringSchema,
});

const contourDatumSchema = objectSchema({
  cx: numberSchema,
  cy: numberSchema,
  rx: numberSchema,
  ry: numberSchema,
  name: stringSchema,
});

export const chartDemoDataSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ChartDemoData',
  ...objectSchema({
    months: stringArraySchema,
    quarters: stringArraySchema,
    days: stringArraySchema,
    revenue: numberArraySchema,
    profitMargin: numberArraySchema,
    responseTime: numberArraySchema,
    temperature: numberArraySchema,
    ohlc: arraySchema(ohlcDatumSchema),
    campaignData: arraySchema(bubbleDatumSchema),
    correlationData: arraySchema(bubbleDatumSchema),
    heatmap: arraySchema(numberArraySchema),
    waterfall: arraySchema(waterfallDatumSchema),
    boxplot: arraySchema(boxplotDatumSchema),
    radar: arraySchema(radarDatumSchema),
    popLabels: stringArraySchema,
    popLeft: numberArraySchema,
    popRight: numberArraySchema,
    sentiment: arraySchema(sentimentDatumSchema),
    timelineEvents: arraySchema(timelineDatumSchema),
    trackingSteps: arraySchema(trackingDatumSchema),
    budget: arraySchema(donutDatumSchema),
    forecastBand: arraySchema(fanDatumSchema),
    pyramidSegments: arraySchema(pyramidDatumSchema),
    surplus: numberArraySchema,
    networkNodes: arraySchema(networkNodeSchema),
    networkEdges: arraySchema(networkEdgeSchema),
    flowNodes: arraySchema(flowNodeSchema),
    flowEdges: arraySchema(flowEdgeSchema),
    rings: arraySchema(ringsDatumSchema),
    venn: arraySchema(vennDatumSchema),
    proportions: arraySchema(proportionDatumSchema),
    contours: arraySchema(contourDatumSchema),
  }),
};

export const chartDemoData: ChartDemoData = {
  months: DEMO_MONTHS,
  quarters: DEMO_QUARTERS,
  days: DEMO_DAYS,
  revenue: DEMO_REVENUE,
  profitMargin: DEMO_MARGIN,
  responseTime: DEMO_RESPONSE_TIME,
  temperature: DEMO_TEMPERATURE,
  ohlc: DEMO_OHLC,
  campaignData: DEMO_CAMPAIGNS,
  correlationData: DEMO_CORRELATION,
  heatmap: DEMO_HEATMAP,
  waterfall: DEMO_WATERFALL,
  boxplot: DEMO_BOXPLOT,
  radar: DEMO_RADAR,
  popLabels: DEMO_POP_LABELS,
  popLeft: DEMO_POP_LEFT,
  popRight: DEMO_POP_RIGHT,
  sentiment: DEMO_SENTIMENT,
  timelineEvents: DEMO_TIMELINE,
  trackingSteps: DEMO_TRACKING,
  budget: DEMO_BUDGET,
  forecastBand: DEMO_FAN,
  pyramidSegments: DEMO_PYRAMID,
  surplus: DEMO_SURPLUS,
  networkNodes: DEMO_NETWORK_NODES,
  networkEdges: DEMO_NETWORK_EDGES,
  flowNodes: DEMO_FLOW_NODES,
  flowEdges: DEMO_FLOW_EDGES,
  rings: DEMO_RINGS,
  venn: DEMO_VENN,
  proportions: DEMO_PROPORTIONS,
  contours: DEMO_CONTOURS,
};

export const chartDemoDataReferences: GalleryDataReference[] = [
  {
    kind: 'dimension',
    label: 'Calendar Dimension',
    targetSource: 'cart/app/gallery/data/calendar-dimension.ts',
    sourceField: 'months / quarters / days',
    targetField: 'months.id / quarters.id / days.id',
    summary:
      'Chart documents currently carry their own label arrays, but the normalized table shape should converge on shared calendar dimension rows.',
  },
];

export function useDemoData(): ChartDemoData {
  return chartDemoData;
}
