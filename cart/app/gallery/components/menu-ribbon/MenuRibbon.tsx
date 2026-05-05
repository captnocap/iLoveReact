import { useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuRibbonProps = { rows: MenuEntry[] };

export function MenuRibbon({ rows }: MenuRibbonProps) {
  const [active, setActive] = useState(0);
  const cur = rows[active];
  return (
    <MenuTileShell id="D2" title="Ribbon tabs" kind="rail">
      <S.MenuRibbon>
        <S.MenuRibbonTabs>
          {rows.map((entry, i) => {
            const Tab = i === active ? S.MenuRibbonTabActive : S.MenuRibbonTab;
            const Label = i === active ? S.MenuLabelActive : S.MenuHint;
            return (
              <Tab key={entry.id} onMouseEnter={() => setActive(i)}>
                <Label>{entry.label.toUpperCase()}</Label>
              </Tab>
            );
          })}
        </S.MenuRibbonTabs>
        <S.MenuRibbonBody>
          <S.MenuEyebrow>§{String(active + 1).padStart(2, '0')}</S.MenuEyebrow>
          <S.MenuPreviewTitle>{cur?.label ?? ''}</S.MenuPreviewTitle>
          <S.MenuHint>{cur?.hint ?? ''}</S.MenuHint>
        </S.MenuRibbonBody>
      </S.MenuRibbon>
    </MenuTileShell>
  );
}
