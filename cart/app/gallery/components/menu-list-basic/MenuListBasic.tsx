import { useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuListBasicProps = { rows: MenuEntry[] };

export function MenuListBasic({ rows }: MenuListBasicProps) {
  const [active, setActive] = useState(0);
  return (
    <MenuTileShell id="A1" title="List · indent caret" kind="list">
      <S.MenuListBox>
        {rows.map((entry, i) => {
          const isActive = i === active;
          const Row = isActive ? S.MenuListRowActive : S.MenuListRow;
          const Label = isActive ? S.MenuLabelActive : S.MenuLabel;
          return (
            <Row key={entry.id} onMouseEnter={() => setActive(i)}>
              {isActive ? <S.MenuCaret>▸</S.MenuCaret> : null}
              <S.MenuListLabelCol>
                <Label>{entry.label}</Label>
              </S.MenuListLabelCol>
              <S.MenuHint>{entry.hint}</S.MenuHint>
            </Row>
          );
        })}
      </S.MenuListBox>
    </MenuTileShell>
  );
}
