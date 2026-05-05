import { useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuGridSquareProps = { rows: MenuEntry[] };

function GridCell({
  entry,
  index,
  active,
  onActivate,
  hero,
}: {
  entry: MenuEntry;
  index: number;
  active: boolean;
  onActivate: () => void;
  hero?: boolean;
}) {
  const Tile = active ? S.MenuGridTileActive : S.MenuGridTile;
  return (
    <Tile onMouseEnter={onActivate}>
      <S.MenuNum>{hero ? 'FEATURED' : `0${index + 1}`}</S.MenuNum>
      {hero ? <S.MenuLabelStrong>{entry.label}</S.MenuLabelStrong> : <S.MenuLabel>{entry.label}</S.MenuLabel>}
      <S.MenuHint>{entry.hint}</S.MenuHint>
    </Tile>
  );
}

export function MenuGridSquareContent({ rows }: MenuGridSquareProps) {
  const [active, setActive] = useState(0);
  const hero = rows[0];
  const small = rows.slice(1);

  return (
    <S.MenuGridBox>
      <S.MenuGridRow>
        {hero ? <GridCell entry={hero} index={0} active={active === 0} onActivate={() => setActive(0)} hero /> : null}
        <S.MenuGridBox>
          <S.MenuGridRow>
            {small.slice(0, 2).map((e, k) => {
              const i = k + 1;
              return <GridCell key={e.id} entry={e} index={i} active={active === i} onActivate={() => setActive(i)} />;
            })}
          </S.MenuGridRow>
          <S.MenuGridRow>
            {small.slice(2, 4).map((e, k) => {
              const i = k + 3;
              return <GridCell key={e.id} entry={e} index={i} active={active === i} onActivate={() => setActive(i)} />;
            })}
          </S.MenuGridRow>
        </S.MenuGridBox>
      </S.MenuGridRow>
      <S.MenuGridRow>
        {small.slice(4, 6).map((e, k) => {
          const i = k + 5;
          return <GridCell key={e.id} entry={e} index={i} active={active === i} onActivate={() => setActive(i)} />;
        })}
      </S.MenuGridRow>
    </S.MenuGridBox>
  );
}

export function MenuGridSquare({ rows }: MenuGridSquareProps) {
  return (
    <MenuTileShell id="C1" title="Grid · 4-up tiles" kind="grid">
      <MenuGridSquareContent rows={rows} />
    </MenuTileShell>
  );
}
