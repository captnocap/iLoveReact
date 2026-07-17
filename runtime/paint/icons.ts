// runtime/paint/icons.ts — each brush shape drawn as path layers: the SVG icon
// that IS the brush choice in the picker (req_1455 — "turn the svg into an icon
// and use that icon as the brush choice over a name"), and the same path is the
// seed for the Phase B host stamp mask. Centered at the origin in a ±12 range,
// pure strings — render with <Graph.Path> (see BrushIcon in controls.tsx).

import type { BrushShape, BrushTool } from './model';

export interface IconLayer {
  d: string;
  /** filled glyph vs stroked outline (e.g. soft halo, fan bristles). */
  fill: boolean;
}

function circle(cx: number, cy: number, r: number): string {
  return `M ${cx},${cy - r} A ${r},${r} 0 1,1 ${cx},${cy + r} A ${r},${r} 0 1,1 ${cx},${cy - r} Z`;
}
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx},${cy - ry} A ${rx},${ry} 0 1,1 ${cx},${cy + ry} A ${rx},${ry} 0 1,1 ${cx},${cy - ry} Z`;
}
function rect(x: number, y: number, w: number, h: number): string {
  return `M ${x},${y} L ${x + w},${y} L ${x + w},${y + h} L ${x},${y + h} Z`;
}
function poly(pts: [number, number][]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]},${p[1]}`).join(' ') + ' Z';
}

/** Path layers for a brush shape's icon. The same shapes the host will stamp. */
export function brushIconLayers(shape: BrushShape): IconLayer[] {
  switch (shape) {
    case 'round':
      return [{ d: circle(0, 0, 9), fill: true }];
    case 'soft': // feathered: a halo ring + a small solid core
      return [{ d: circle(0, 0, 9), fill: false }, { d: circle(0, 0, 4), fill: true }];
    case 'square':
      return [{ d: rect(-8, -8, 16, 16), fill: true }];
    case 'flat':
      return [{ d: rect(-10, -3.5, 20, 7), fill: true }];
    case 'angle':
      return [{ d: poly([[-10, 3], [4, -5], [10, -1], [-4, 7]]), fill: true }];
    case 'filbert':
      return [{ d: ellipse(0, 0, 9, 5), fill: true }];
    case 'rake': // a comb of bristles
      return [{ d: `${rect(-9, -8, 3, 16)} ${rect(-1.5, -8, 3, 16)} ${rect(6, -8, 3, 16)}`, fill: true }];
    case 'fan': { // bristles radiating from the heel
      const layers: IconLayer[] = [];
      for (let i = -2; i <= 2; i++) {
        const a = (i * 24 - 90) * (Math.PI / 180);
        layers.push({ d: `M 0,9 L ${(Math.cos(a) * 17).toFixed(1)},${(9 + Math.sin(a) * 17).toFixed(1)}`, fill: false });
      }
      return layers;
    }
    case 'dry': { // broken, dry-brush speckle
      const dots: [number, number][] = [[-7, -5], [-2, 2], [3, -3], [7, 4], [-5, 6], [5, -7], [0, -7], [2, 7]];
      return [{ d: dots.map(([x, y]) => rect(x - 2, y - 2, 4, 4)).join(' '), fill: true }];
    }
    case 'spray': { // airbrush dot cloud (golden-angle scatter)
      let d = '';
      for (let i = 0; i < 16; i++) {
        const a = i * 2.39996;
        const r = 2 + (i % 5) * 1.7;
        d += circle(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1, 1.1) + ' ';
      }
      return [{ d: d.trim(), fill: true }];
    }
    case 'knife':
      return [{ d: poly([[-10, 5], [7, -5], [10, -3], [-7, 7]]), fill: true }];
  }
}

/** Path layers for a TOOL's icon — every tool ships with a standard glyph so
 *  the tool picker is icons, not names (req_1460). Same ±12 centered space. */
export function toolIconLayers(tool: BrushTool): IconLayer[] {
  switch (tool) {
    case 'brush': // a paintbrush: handle + bristle tip
      return [
        { d: 'M 9,-9 L -1,1', fill: false },
        { d: poly([[-1, 1], [-7, 3], [-3, 9], [3, 5]]), fill: true },
      ];
    case 'eraser': // a tilted eraser block
      return [{ d: poly([[-8, 4], [-1, -5], [8, -5], [1, 4]]), fill: true }];
    case 'line':
      return [{ d: 'M -9,8 L 9,-8', fill: false }];
    case 'rect':
      return [{ d: rect(-8, -6, 16, 12), fill: false }];
    case 'ellipse':
      return [{ d: ellipse(0, 0, 9, 6), fill: false }];
    case 'eyedropper': // pipette: bulb + body + drop
      return [
        { d: rect(4, -10, 6, 4), fill: true },
        { d: 'M 7,-6 L -4,5', fill: false },
        { d: poly([[-4, 5], [-7, 9], [-1, 9]]), fill: true },
      ];
    case 'fill': // paint bucket + a drip
      return [
        { d: poly([[-7, -3], [5, -5], [3, 8], [-5, 6]]), fill: true },
        { d: circle(8, 4, 1.8), fill: true },
      ];
    case 'smudge': // a smeared zigzag
      return [{ d: 'M -9,3 L -3,-4 L 3,3 L 9,-4', fill: false }];
    case 'blur': // soft concentric rings
      return [{ d: circle(0, 0, 8), fill: false }, { d: circle(0, 0, 4), fill: false }];
    case 'text': // a capital T: top bar + stem
      return [{ d: 'M -8,-7 L 8,-7', fill: false }, { d: 'M 0,-7 L 0,8', fill: false }];
    case 'marquee': // dashed rectangular selection
      return [
        { d: 'M -9,-7 L -3,-7 M 2,-7 L 8,-7 M 9,-6 L 9,-1 M 9,3 L 9,7 M 8,8 L 2,8 M -3,8 L -9,8 M -10,7 L -10,2 M -10,-2 L -10,-7', fill: false },
      ];
    case 'lasso': // freehand loop + tail
      return [{ d: 'M 7,4 C 5,9 -7,9 -9,2 C -11,-6 0,-10 7,-6 C 12,-3 10,3 4,4 C -1,5 -3,2 -1,0 M 4,4 L 9,9', fill: false }];
  }
}
