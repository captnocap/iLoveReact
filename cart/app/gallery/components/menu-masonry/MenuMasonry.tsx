import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuMasonryProps = { rows: MenuEntry[] };

export function MenuMasonry({ rows }: MenuMasonryProps) {
  const [active, setActive] = useState(0);

  const Tile = ({ i, weight, hero }: { i: number; weight: number; hero?: boolean }) => {
    const entry = rows[i];
    if (!entry) return null;
    const isActive = i === active;
    const Cell = isActive ? S.MenuGridTileActive : S.MenuGridTile;
    return (
      <Box style={{ flex: weight }}>
        <Cell onMouseEnter={() => setActive(i)}>
          <S.MenuNumAccent>{hero ? 'FEATURED' : `0${i + 1}`}</S.MenuNumAccent>
          {hero ? <S.MenuLabelStrong>{entry.label}</S.MenuLabelStrong> : <S.MenuLabel>{entry.label}</S.MenuLabel>}
          <S.MenuHint>{entry.hint}</S.MenuHint>
        </Cell>
      </Box>
    );
  };

  return (
    <MenuTileShell id="C5" title="Masonry · mixed scale" kind="grid">
      <S.MenuGridBox>
        {/* hero row */}
        <Box style={{ flex: 1.5 }}>
          <S.MenuGridRow>
            <Tile i={0} weight={1} hero />
          </S.MenuGridRow>
        </Box>
        {/* mid row: small + wide */}
        <S.MenuGridRow>
          <Tile i={1} weight={1} />
          <Tile i={2} weight={2} />
        </S.MenuGridRow>
        {/* bottom row: wide + small + small */}
        <S.MenuGridRow>
          <Tile i={3} weight={2} />
          <Tile i={4} weight={1} />
          <Tile i={5} weight={1} />
        </S.MenuGridRow>
      </S.MenuGridBox>
    </MenuTileShell>
  );
}
