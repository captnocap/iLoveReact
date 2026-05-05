import { useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuDockProps = { rows: MenuEntry[] };

export function MenuDock({ rows }: MenuDockProps) {
  const [active, setActive] = useState(0);
  const cur = rows[active];
  return (
    <MenuTileShell id="D3" title="Bottom dock" kind="rail">
      <S.MenuDock>
        <S.MenuDockStage>
          <S.MenuHintDim>STAGE</S.MenuHintDim>
          <S.MenuPreviewTitle>{cur?.label ?? ''}</S.MenuPreviewTitle>
          <S.MenuHint>{cur?.hint ?? ''}</S.MenuHint>
        </S.MenuDockStage>
        <S.MenuDockBar>
          {rows.map((entry, i) => {
            const Btn = i === active ? S.MenuDockBtnActive : S.MenuDockBtn;
            const Glyph = i === active ? S.MenuDockGlyphActive : S.MenuDockGlyph;
            const Label = i === active ? S.MenuLabelActive : S.MenuHint;
            return (
              <Btn key={entry.id} onMouseEnter={() => setActive(i)}>
                <Glyph>{entry.glyph ?? '◇'}</Glyph>
                <Label>{entry.label}</Label>
              </Btn>
            );
          })}
        </S.MenuDockBar>
      </S.MenuDock>
    </MenuTileShell>
  );
}
