import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuFolderProps = { rows: MenuEntry[] };

export function MenuFolder({ rows }: MenuFolderProps) {
  const [active, setActive] = useState(0);
  const cur = rows[active];
  return (
    <MenuTileShell id="E2" title="File folder" kind="card">
      <S.MenuFolder>
        <S.MenuFolderTabs>
          {rows.map((entry, i) => {
            const Tab = i === active ? S.MenuFolderTabActive : S.MenuFolderTab;
            const Label = i === active ? S.MenuLabelActive : S.MenuHint;
            return (
              <Tab key={entry.id} onMouseEnter={() => setActive(i)}>
                <Label>{entry.label.slice(0, 4).toUpperCase()}</Label>
              </Tab>
            );
          })}
        </S.MenuFolderTabs>
        <S.MenuFolderBody>
          <S.MenuEyebrow>TAB · {String(active + 1).padStart(2, '0')}</S.MenuEyebrow>
          <S.MenuPreviewTitle>{cur?.label ?? ''}</S.MenuPreviewTitle>
          <S.MenuHint>{cur?.hint ?? ''}</S.MenuHint>
          <Box style={{ flex: 1 }} />
          <Box style={{ flexDirection: 'row', gap: 16 }}>
            <S.MenuHintDim>FILED · 04.27</S.MenuHintDim>
            <S.MenuHintDim>REV · 03</S.MenuHintDim>
            <S.MenuHintDim>{cur?.id?.toUpperCase() ?? ''}-{String(active + 1).padStart(3, '0')}</S.MenuHintDim>
          </Box>
        </S.MenuFolderBody>
      </S.MenuFolder>
    </MenuTileShell>
  );
}
