import { useState } from 'react';
import { Box, Graph, Pressable, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

// Graph origin (0, 0) is the CENTER of the canvas. The fan pivots from a
// point near the bottom of the visible area and sweeps overhead. All path
// math is in centered coords; Pressable hit-targets translate via HALF_*.

const W = 500;
const H = 340;
const HALF_W = W / 2;
const HALF_H = H / 2;
const PIVOT_Y = 150; // graph y of the fan pivot (just inside the bottom edge)
const R_OUTER = 290;
const R_INNER = 70;
const A_START = (-160 * Math.PI) / 180;
const A_END = (-20 * Math.PI) / 180;
const A_SPAN = A_END - A_START;

function bladePath(i: number, total: number): string {
  const a0 = A_START + (i / total) * A_SPAN;
  const a1 = A_START + ((i + 1) / total) * A_SPAN;
  const x0 = Math.cos(a0) * R_OUTER, y0 = PIVOT_Y + Math.sin(a0) * R_OUTER;
  const x1 = Math.cos(a1) * R_OUTER, y1 = PIVOT_Y + Math.sin(a1) * R_OUTER;
  const xi0 = Math.cos(a0) * R_INNER, yi0 = PIVOT_Y + Math.sin(a0) * R_INNER;
  const xi1 = Math.cos(a1) * R_INNER, yi1 = PIVOT_Y + Math.sin(a1) * R_INNER;
  return `M ${xi0} ${yi0} L ${x0} ${y0} A ${R_OUTER} ${R_OUTER} 0 0 1 ${x1} ${y1} L ${xi1} ${yi1} A ${R_INNER} ${R_INNER} 0 0 0 ${xi0} ${yi0} Z`;
}

function outerArcPath(): string {
  const x0 = Math.cos(A_START) * R_OUTER, y0 = PIVOT_Y + Math.sin(A_START) * R_OUTER;
  const x1 = Math.cos(A_END) * R_OUTER,   y1 = PIVOT_Y + Math.sin(A_END) * R_OUTER;
  return `M ${x0} ${y0} A ${R_OUTER} ${R_OUTER} 0 0 1 ${x1} ${y1}`;
}

function midPos(i: number, total: number): { gx: number; gy: number } {
  const a = A_START + ((i + 0.5) / total) * A_SPAN;
  const r = (R_OUTER + R_INNER) / 2;
  return { gx: Math.cos(a) * r, gy: PIVOT_Y + Math.sin(a) * r };
}

export type MenuFanProps = { rows: MenuEntry[] };

export function MenuFan({ rows }: MenuFanProps) {
  const [active, setActive] = useState(0);

  return (
    <MenuTileShell id="B4" title="Fan" kind="radial">
      <S.MenuRadialBox>
        <Box style={{ position: 'relative', width: W, height: H, flexShrink: 0 }}>
          <Graph style={{ width: W, height: H }}>
            <Graph.Path d={outerArcPath()} fill="none" stroke="theme:paperRule" strokeWidth={2} />
            {rows.map((_, i) => (
              <Graph.Path
                key={`blade-${i}`}
                d={bladePath(i, rows.length)}
                fill={i === active ? 'theme:paperInk' : 'theme:bg1'}
                stroke={i === active ? 'theme:warn' : 'theme:paperInkDim'}
                strokeWidth={i === active ? 3 : 2}
              />
            ))}
          </Graph>

          {rows.map((entry, i) => {
            const { gx, gy } = midPos(i, rows.length);
            return (
              <Pressable
                key={entry.id}
                onMouseEnter={() => setActive(i)}
                style={{
                  position: 'absolute',
                  left: HALF_W + gx - 50, top: HALF_H + gy - 10,
                  width: 100, height: 20,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: 'monospace', fontSize: 10, color: i === active ? 'theme:warn' : 'theme:ink', letterSpacing: 1.4 }}>
                  {entry.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </Box>
      </S.MenuRadialBox>
    </MenuTileShell>
  );
}
