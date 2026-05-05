import { useState } from 'react';
import { Box, Graph, Pressable, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

// Graph coordinate system: origin (0, 0) is at the CENTER of the canvas,
// y increases downward. Wedge geometry is expressed in those coords.
// Pressable hit-targets use top-left wrapper coords; we add HALF to translate.

const SIZE = 340;
const HALF = SIZE / 2;
const R_OUTER = 140;
const R_INNER = 56;

function wedgePath(i: number, total: number): string {
  const a0 = (i / total) * Math.PI * 2 - Math.PI / 2;
  const a1 = ((i + 1) / total) * Math.PI * 2 - Math.PI / 2;
  const x0 = Math.cos(a0) * R_OUTER, y0 = Math.sin(a0) * R_OUTER;
  const x1 = Math.cos(a1) * R_OUTER, y1 = Math.sin(a1) * R_OUTER;
  const xi0 = Math.cos(a0) * R_INNER, yi0 = Math.sin(a0) * R_INNER;
  const xi1 = Math.cos(a1) * R_INNER, yi1 = Math.sin(a1) * R_INNER;
  return `M ${xi0} ${yi0} L ${x0} ${y0} A ${R_OUTER} ${R_OUTER} 0 0 1 ${x1} ${y1} L ${xi1} ${yi1} A ${R_INNER} ${R_INNER} 0 0 0 ${xi0} ${yi0} Z`;
}

function ringPath(r: number): string {
  return `M ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 Z`;
}

function midPos(i: number, total: number): { gx: number; gy: number } {
  const a = ((i + 0.5) / total) * Math.PI * 2 - Math.PI / 2;
  const r = (R_OUTER + R_INNER) / 2;
  return { gx: Math.cos(a) * r, gy: Math.sin(a) * r };
}

export type MenuPieProps = { rows: MenuEntry[] };

export function MenuPie({ rows }: MenuPieProps) {
  const [active, setActive] = useState(0);
  const cur = rows[active];

  return (
    <MenuTileShell id="B2" title="Pie wedges" kind="radial" ratio="square">
      <S.MenuRadialBox>
        <Box style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
          <Graph style={{ width: SIZE, height: SIZE }}>
            <Graph.Path d={ringPath(R_OUTER)} fill="none" stroke="theme:paperRule" strokeWidth={2} />
            <Graph.Path d={ringPath(R_INNER)} fill="none" stroke="theme:paperRule" strokeWidth={2} />
            {rows.map((_, i) => (
              <Graph.Path
                key={`wedge-${i}`}
                d={wedgePath(i, rows.length)}
                fill={i === active ? 'theme:paperInk' : 'theme:bg1'}
                stroke={i === active ? 'theme:accent' : 'theme:paperInkDim'}
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
                  left: HALF + gx - 44, top: HALF + gy - 10,
                  width: 88, height: 20,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: 'monospace', fontSize: 10, color: i === active ? 'theme:accent' : 'theme:ink', letterSpacing: 1.2 }}>
                  {entry.label.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}

          <Box
            style={{
              position: 'absolute',
              left: HALF - 60, top: HALF - 22,
              width: 120, height: 44,
              alignItems: 'center', justifyContent: 'center',
              gap: 2,
            }}
          >
            <S.MenuEyebrow>0{active + 1}</S.MenuEyebrow>
            <S.MenuLabelStrong>{cur?.label ?? ''}</S.MenuLabelStrong>
          </Box>
        </Box>
      </S.MenuRadialBox>
    </MenuTileShell>
  );
}
