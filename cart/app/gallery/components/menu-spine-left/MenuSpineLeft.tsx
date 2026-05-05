import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuSpineLeftProps = { rows: MenuEntry[] };

export function MenuSpineLeft({ rows }: MenuSpineLeftProps) {
  const [active, setActive] = useState(0);
  const cur = rows[active];
  return (
    <MenuTileShell id="D1" title="Left rail · preview" kind="rail">
      <S.MenuSpine>
        <S.MenuRail>
          {rows.map((entry, i) => {
            const Btn = i === active ? S.MenuRailBtnActive : S.MenuRailBtn;
            const Label = i === active ? S.MenuLabelActive : S.MenuLabel;
            return (
              <Btn key={entry.id} onMouseEnter={() => setActive(i)}>
                <Label>{entry.key}</Label>
              </Btn>
            );
          })}
        </S.MenuRail>
        <S.MenuPreview>
          <S.MenuEyebrow>CHANNEL · {String(active + 1).padStart(2, '0')}</S.MenuEyebrow>
          <S.MenuPreviewTitle>{cur?.label ?? ''}</S.MenuPreviewTitle>
          <S.MenuHint>{cur?.hint ?? ''}</S.MenuHint>
          <Box style={{ flex: 1 }} />
          <Box style={{ flexDirection: 'row', gap: 14 }}>
            <S.MenuHintDim>↵ select</S.MenuHintDim>
            <S.MenuHintDim>↑↓ move</S.MenuHintDim>
            <S.MenuHintDim>esc back</S.MenuHintDim>
          </Box>
        </S.MenuPreview>
      </S.MenuSpine>
    </MenuTileShell>
  );
}
