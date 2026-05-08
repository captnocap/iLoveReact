import { Box, Graph, SdfIcon } from '../primitives';
import { lookupIcon } from './registry';
import { BAKED_ICON_NAMES } from './baked-names';

export type IconData = number[][];
export type IconName = string;

const VIEW = 24;
const HALF = 12;
const SIMPLIFY_EPSILON = 0.35;

const namedPathCache = new Map<string, IconData>();
const directPathCache = new WeakMap<IconData, IconData>();

function pointLineDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplifyPointRange(points: number[][], start: number, end: number, keep: boolean[]): void {
  if (end <= start + 1) return;
  const ax = points[start][0];
  const ay = points[start][1];
  const bx = points[end][0];
  const by = points[end][1];
  let maxDistance = 0;
  let split = start;

  for (let i = start + 1; i < end; i++) {
    const distance = pointLineDistance(points[i][0], points[i][1], ax, ay, bx, by);
    if (distance > maxDistance) {
      maxDistance = distance;
      split = i;
    }
  }

  if (maxDistance > SIMPLIFY_EPSILON) {
    keep[split] = true;
    simplifyPointRange(points, start, split, keep);
    simplifyPointRange(points, split, end, keep);
  }
}

function simplifyPolyline(poly: number[]): number[] {
  if (poly.length <= 8) return poly;
  const points: number[][] = [];
  for (let i = 0; i + 1 < poly.length; i += 2) {
    points.push([poly[i], poly[i + 1]]);
  }
  if (points.length <= 2) return poly;

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  simplifyPointRange(points, 0, points.length - 1, keep);

  const out: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i][0], points[i][1]);
  }
  return out.length >= 4 ? out : poly;
}

function simplifyIconData(paths: IconData): IconData {
  return paths.map(simplifyPolyline);
}

function resolvePaths(name?: IconName, icon?: IconData): IconData | undefined {
  if (icon) {
    const cached = directPathCache.get(icon);
    if (cached) return cached;
    const simplified = simplifyIconData(icon);
    directPathCache.set(icon, simplified);
    return simplified;
  }

  if (!name) return undefined;
  const cached = namedPathCache.get(name);
  if (cached) return cached;
  const paths = lookupIcon(name);
  if (!paths) return undefined;
  const simplified = simplifyIconData(paths);
  namedPathCache.set(name, simplified);
  return simplified;
}

function polylineToD(poly: number[]): string {
  if (poly.length < 4) return '';
  let out = `M ${poly[0] - HALF},${poly[1] - HALF}`;
  for (let i = 2; i < poly.length; i += 2) {
    out += ` L ${poly[i] - HALF},${poly[i + 1] - HALF}`;
  }
  return out;
}

function renderPaths(paths: IconData, color: string, strokeWidth: number) {
  return paths.map((poly, index) => (
    <Graph.Path
      key={index}
      d={polylineToD(poly)}
      stroke={color}
      strokeWidth={strokeWidth}
      fill="none"
    />
  ));
}

// Resolve user-supplied icon name to the exact PascalCase key used by the
// SDF atlas + the icons.ts registry. "heart" / "Heart" / "arrow-right" all
// normalize: leading char + each post-`-_` char to uppercase, separators
// dropped. Mirrors registry.ts::toPascalCase.
function toBakedKey(name: string): string {
  return name.replace(/(^|[-_])([a-z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/[-_]/g, '');
}

export function Icon(props: {
  name?: IconName;
  icon?: IconData;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const size = props.size ?? 16;
  const color = props.color ?? 'theme:ink';
  const strokeWidth = props.strokeWidth ?? 2;

  // SDF fast path — exact-name lookup against the pre-baked atlas. Beats
  // the path-render path by a wide margin: 1 batched quad regardless of
  // count, no per-paint string parsing, no curve tessellation. Custom
  // `icon={data}` paths skip this (their geometry isn't in the atlas).
  if (props.name && !props.icon) {
    const key = toBakedKey(props.name);
    if (BAKED_ICON_NAMES.has(key)) {
      return <SdfIcon name={key} size={size} color={color} />;
    }
  }

  const paths = resolvePaths(props.name, props.icon);

  if (!paths || paths.length === 0) {
    return <Box style={{ width: size, height: size }} />;
  }

  return (
    <Box style={{ width: size, height: size, overflow: 'hidden' }}>
      <Graph
        style={{ width: size, height: size }}
        viewX={0}
        viewY={0}
        viewZoom={size / VIEW}
      >
        {renderPaths(paths, color, strokeWidth)}
      </Graph>
    </Box>
  );
}
