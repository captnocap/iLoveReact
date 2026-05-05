import { useState } from 'react';
import { Box, Graph, Pressable, Text } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

const W = 400;
const H = 220;
const STEP_W = 60;
const STEP_H = 38;
const STEP_GAP = 12;
const STEP_Y = 90;
const STEP_COUNT = 5;

export type MenuFlowProps = { rows: MenuEntry[] };

export function MenuFlow({ rows }: MenuFlowProps) {
  const [active, setActive] = useState(0);
  const steps = rows.slice(0, STEP_COUNT);
  const extras = rows.slice(STEP_COUNT);
  const totalW = steps.length * STEP_W + (steps.length - 1) * STEP_GAP;
  const startX = (W - totalW) / 2;

  return (
    <MenuTileShell id="F3" title="Flow · linear" kind="diag">
      <Box style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
        <Graph style={{ width: W, height: H }}>
          {steps.map((_, i) => {
            const x = startX + i * (STEP_W + STEP_GAP);
            const isActive = i === active;
            return (
              <Graph.Path
                key={`step-${i}`}
                d={`M ${x} ${STEP_Y} L ${x + STEP_W} ${STEP_Y} L ${x + STEP_W} ${STEP_Y + STEP_H} L ${x} ${STEP_Y + STEP_H} Z`}
                fill={isActive ? 'theme:accentHot' : 'theme:bg1'}
                stroke={isActive ? 'theme:accentHot' : 'theme:ruleBright'}
                strokeWidth={1}
              />
            );
          })}
          {steps.slice(0, -1).map((_, i) => {
            const x = startX + i * (STEP_W + STEP_GAP);
            const live = i < active;
            const stroke = live ? 'theme:accent' : 'theme:ruleBright';
            return (
              <Graph.Path
                key={`arrow-${i}`}
                d={`M ${x + STEP_W + 1} ${STEP_Y + 19} L ${x + STEP_W + STEP_GAP - 4} ${STEP_Y + 19}`}
                stroke={stroke}
                strokeWidth={1.4}
                fill="none"
              />
            );
          })}
        </Graph>

        {steps.map((entry, i) => {
          const x = startX + i * (STEP_W + STEP_GAP);
          return (
            <Pressable
              key={entry.id}
              onMouseEnter={() => setActive(i)}
              style={{
                position: 'absolute',
                left: x, top: STEP_Y,
                width: STEP_W, height: STEP_H,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: 'monospace', fontSize: 9, color: 'theme:ink', letterSpacing: 1 }}>
                {entry.label.toUpperCase()}
              </Text>
              <Text style={{ fontFamily: 'monospace', fontSize: 8, color: 'theme:paperInkDim', position: 'absolute', top: -14 }}>
                STEP {i + 1}
              </Text>
            </Pressable>
          );
        })}

        <Box style={{ position: 'absolute', bottom: 30, left: 24, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <S.MenuHintDim>ALSO ─</S.MenuHintDim>
          {extras.map((entry, k) => {
            const idx = STEP_COUNT + k;
            const isActive = idx === active;
            const Label = isActive ? S.MenuLabelActive : S.MenuLabel;
            return (
              <Pressable key={entry.id} onMouseEnter={() => setActive(idx)} style={{ paddingLeft: 4, paddingRight: 4 }}>
                <Label>{entry.label.toUpperCase()}</Label>
              </Pressable>
            );
          })}
        </Box>
      </Box>
    </MenuTileShell>
  );
}
