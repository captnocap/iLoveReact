import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuListMarkerProps = { rows: MenuEntry[] };

export function MenuListMarker({ rows }: MenuListMarkerProps) {
  const [active, setActive] = useState(0);
  const ROW_HEIGHT = 28;
  const HEAD_PAD = 24;
  return (
    <MenuTileShell id="A5" title="Sliding marker" kind="list">
      <S.MenuMarkerBox>
        <Box style={{ position: 'absolute', left: 8, right: 8, top: HEAD_PAD + active * ROW_HEIGHT, height: ROW_HEIGHT }}>
          <S.MenuMarkerSlab />
        </Box>
        {rows.map((entry, i) => {
          const isActive = i === active;
          const Label = isActive ? S.MenuLabelActive : S.MenuLabel;
          return (
            <S.MenuMarkerRow key={entry.id} onMouseEnter={() => setActive(i)}>
              <Label>{entry.label}</Label>
            </S.MenuMarkerRow>
          );
        })}
      </S.MenuMarkerBox>
    </MenuTileShell>
  );
}
