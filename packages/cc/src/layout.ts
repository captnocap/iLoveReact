/**
 * Simplified character-grid flexbox layout for ComputerCraft.
 *
 * Operates on the reconciler's Instance tree and computes
 * { x, y, w, h } in integer character coordinates.
 *
 * Supports: width, height (absolute or %), flexDirection, flexGrow,
 * padding, gap, and pass-through of style props (backgroundColor, color).
 */

import type { Instance } from '@ilovereact/native';

export interface LayoutNode {
  id: number;
  type: string;
  x: number;       // 1-based column (CC uses 1-based)
  y: number;       // 1-based row
  w: number;
  h: number;
  text?: string;
  style: Record<string, any>;
  children: LayoutNode[];
}

interface Size {
  w: number;
  h: number;
}

/** Resolve a dimension value (number, "50%", etc.) against a parent size. */
function resolveDim(value: any, parentSize: number): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Math.round(value);
  if (typeof value === 'string' && value.endsWith('%')) {
    const pct = parseFloat(value) / 100;
    return Math.round(parentSize * pct);
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

/** Get text content from an Instance (looks at children for __TEXT__ nodes). */
function getTextContent(instance: Instance): string | undefined {
  if ((instance as any).text != null) return String((instance as any).text);
  for (const child of instance.children) {
    if ((child as any).type === '__TEXT__' && (child as any).text != null) {
      return String((child as any).text);
    }
  }
  return undefined;
}

/** Extract padding from style, returns all 4 sides. */
function getPadding(style: Record<string, any>): { t: number; r: number; b: number; l: number } {
  const p = Math.round(Number(style.padding) || 0);
  return {
    t: Math.round(Number(style.paddingTop) || p),
    r: Math.round(Number(style.paddingRight) || p),
    b: Math.round(Number(style.paddingBottom) || p),
    l: Math.round(Number(style.paddingLeft) || p),
  };
}

/**
 * Compute layout for an Instance tree within a given grid.
 *
 * @param root The root Instance from the reconciler
 * @param gridW Grid width in characters (default 51 for CC)
 * @param gridH Grid height in characters (default 19 for CC)
 * @returns Root LayoutNode with computed positions
 */
export function computeLayout(root: Instance, gridW = 51, gridH = 19): LayoutNode {
  return layoutNode(root, 1, 1, gridW, gridH);
}

function layoutNode(
  instance: Instance,
  x: number,
  y: number,
  availW: number,
  availH: number,
): LayoutNode {
  const style = instance.props?.style || {};

  // Resolve own dimensions
  const explicitW = resolveDim(style.width, availW);
  const explicitH = resolveDim(style.height, availH);
  const w = Math.min(explicitW ?? availW, availW);
  const h = Math.min(explicitH ?? availH, availH);

  const pad = getPadding(style);
  const innerX = x + pad.l;
  const innerY = y + pad.t;
  const innerW = Math.max(0, w - pad.l - pad.r);
  const innerH = Math.max(0, h - pad.t - pad.b);

  // Text nodes are leaf nodes
  const text = getTextContent(instance);
  if (instance.type === 'Text' || instance.type === '__TEXT__') {
    return {
      id: instance.id,
      type: instance.type,
      x, y, w, h,
      text: text?.slice(0, w), // truncate to fit
      style,
      children: [],
    };
  }

  // Layout children with flexbox
  const direction: string = style.flexDirection || 'column';
  const isRow = direction === 'row';
  const gap = Math.round(Number(style.gap) || 0);

  const childInstances = instance.children.filter(
    (c): c is Instance => 'type' in c && (c as any).type !== '__TEXT__'
  );

  // First pass: measure fixed-size children, collect flex growers
  interface ChildMeasure {
    instance: Instance;
    fixedMain: number | null;
    fixedCross: number | null;
    flexGrow: number;
  }

  const measures: ChildMeasure[] = [];
  let totalFixed = 0;
  let totalGrow = 0;
  const totalGaps = Math.max(0, childInstances.length - 1) * gap;

  const mainAvail = isRow ? innerW : innerH;
  const crossAvail = isRow ? innerH : innerW;

  for (const child of childInstances) {
    const cs = child.props?.style || {};
    const grow = Number(cs.flexGrow) || 0;
    const fixedMain = resolveDim(isRow ? cs.width : cs.height, mainAvail);
    const fixedCross = resolveDim(isRow ? cs.height : cs.width, crossAvail);

    measures.push({ instance: child, fixedMain, fixedCross, flexGrow: grow });

    if (fixedMain != null) {
      totalFixed += fixedMain;
    }
    totalGrow += grow;
  }

  // Distribute remaining space to flex growers
  const remainingMain = Math.max(0, mainAvail - totalFixed - totalGaps);
  const childLayouts: LayoutNode[] = [];
  let cursor = 0;

  for (const m of measures) {
    let childMain: number;
    if (m.fixedMain != null) {
      childMain = m.fixedMain;
    } else if (m.flexGrow > 0 && totalGrow > 0) {
      childMain = Math.round((m.flexGrow / totalGrow) * remainingMain);
    } else {
      // No explicit size, no grow: give remaining space equally among unsized children
      const unsized = measures.filter(mm => mm.fixedMain == null && mm.flexGrow === 0).length;
      childMain = unsized > 0 ? Math.round(remainingMain / unsized) : 0;
    }

    const childCross = m.fixedCross ?? crossAvail;

    const cx = isRow ? innerX + cursor : innerX;
    const cy = isRow ? innerY : innerY + cursor;
    const cw = isRow ? childMain : Math.min(childCross, innerW);
    const ch = isRow ? Math.min(childCross, innerH) : childMain;

    if (cw > 0 && ch > 0) {
      childLayouts.push(layoutNode(m.instance, cx, cy, cw, ch));
    }

    cursor += childMain + gap;
  }

  return {
    id: instance.id,
    type: instance.type,
    x, y, w, h,
    text,
    style,
    children: childLayouts,
  };
}
