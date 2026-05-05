import { useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuListKeyedProps = { rows: MenuEntry[] };

export function MenuListKeyed({ rows }: MenuListKeyedProps) {
  const [active, setActive] = useState(0);
  return (
    <MenuTileShell id="A3" title="Keyed · single key" kind="list">
      <S.MenuListBox>
        {rows.map((entry, i) => {
          const isActive = i === active;
          const Row = isActive ? S.MenuKeyedRowActive : S.MenuKeyedRow;
          const Label = isActive ? S.MenuLabelActive : S.MenuLabelStrong;
          return (
            <Row key={entry.id} onMouseEnter={() => setActive(i)}>
              <S.MenuKey>[{entry.key}]</S.MenuKey>
              <Label>{entry.label}</Label>
            </Row>
          );
        })}
      </S.MenuListBox>
    </MenuTileShell>
  );
}
