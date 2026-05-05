import { useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuCurtainProps = { rows: MenuEntry[] };

export function MenuCurtain({ rows }: MenuCurtainProps) {
  const [active, setActive] = useState(0);
  return (
    <MenuTileShell id="G4" title="Curtain · expand row" kind="spatial">
      <S.MenuCurtain>
        {rows.map((entry, i) => {
          const isActive = i === active;
          const Row = isActive ? S.MenuCurtainRowActive : S.MenuCurtainRow;
          const Label = isActive ? S.MenuDisplayLabelActive : S.MenuDisplayLabel;
          return (
            <Row key={entry.id} onMouseEnter={() => setActive(i)}>
              <S.MenuNumAccent>0{i + 1}</S.MenuNumAccent>
              <Label>{entry.label}</Label>
              <S.MenuCurtainSpacer />
              {isActive ? <S.MenuHint>{entry.hint}</S.MenuHint> : null}
            </Row>
          );
        })}
      </S.MenuCurtain>
    </MenuTileShell>
  );
}
