import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuDepthProps = { rows: MenuEntry[] };

export function MenuDepth({ rows }: MenuDepthProps) {
  const [active, setActive] = useState(0);
  return (
    <MenuTileShell id="G1" title="Depth tiers" kind="spatial">
      <S.MenuDepth>
        {rows.map((entry, i) => {
          const isActive = i === active;
          const Row = isActive ? S.MenuDepthRowActive : S.MenuDepthRow;
          const Label = isActive ? S.MenuDisplayLabelActive : S.MenuDisplayLabel;
          return (
            <Box key={entry.id} style={{ transform: [{ translateX: isActive ? 20 : 0 }] }}>
              <Row onMouseEnter={() => setActive(i)}>
                <S.MenuNumAccent>0{i + 1}</S.MenuNumAccent>
                <Label>{entry.label}</Label>
              </Row>
            </Box>
          );
        })}
      </S.MenuDepth>
    </MenuTileShell>
  );
}
