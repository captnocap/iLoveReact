/**
 * Flatten a LayoutNode tree into an array of draw commands
 * suitable for ComputerCraft's term/paintutils API.
 *
 * Walks depth-first, clips children to parent bounds,
 * and quantizes colors via the CC palette.
 */

import type { LayoutNode } from './layout';
import { nearestCCColor, CC_DEFAULT_FG, CC_DEFAULT_BG } from './palette';

export interface DrawCommand {
  x: number;      // 1-based column
  y: number;      // 1-based row
  w: number;
  h: number;
  bg?: number;    // CC color ID
  text?: string;  // text content (truncated to w)
  fg?: number;    // CC color ID for text
}

interface ClipRect {
  x1: number;
  y1: number;
  x2: number;  // exclusive
  y2: number;  // exclusive
}

function intersect(a: ClipRect, b: ClipRect): ClipRect | null {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  if (x1 >= x2 || y1 >= y2) return null;
  return { x1, y1, x2, y2 };
}

/**
 * Flatten a LayoutNode tree to draw commands.
 */
export function flatten(root: LayoutNode): DrawCommand[] {
  const commands: DrawCommand[] = [];
  const clip: ClipRect = {
    x1: root.x,
    y1: root.y,
    x2: root.x + root.w,
    y2: root.y + root.h,
  };
  flattenNode(root, clip, commands);
  return commands;
}

function flattenNode(
  node: LayoutNode,
  parentClip: ClipRect,
  out: DrawCommand[],
): void {
  const nodeRect: ClipRect = {
    x1: node.x,
    y1: node.y,
    x2: node.x + node.w,
    y2: node.y + node.h,
  };

  const clipped = intersect(nodeRect, parentClip);
  if (!clipped) return;

  const w = clipped.x2 - clipped.x1;
  const h = clipped.y2 - clipped.y1;

  // Emit background fill
  const bgColor = node.style.backgroundColor || node.style.background;
  if (bgColor) {
    out.push({
      x: clipped.x1,
      y: clipped.y1,
      w,
      h,
      bg: nearestCCColor(bgColor),
    });
  }

  // Emit text
  if (node.text && (node.type === 'Text' || node.type === '__TEXT__')) {
    const fg = node.style.color ? nearestCCColor(node.style.color) : CC_DEFAULT_FG;
    const bg = bgColor ? nearestCCColor(bgColor) : undefined;

    // Truncate text to clipped width
    const truncated = node.text.slice(0, w);
    if (truncated.length > 0) {
      out.push({
        x: clipped.x1,
        y: clipped.y1,
        w,
        h: 1, // text occupies one row
        text: truncated,
        fg,
        bg,
      });
    }
  }

  // Recurse children with this node's clip rect
  for (const child of node.children) {
    flattenNode(child, clipped, out);
  }
}
