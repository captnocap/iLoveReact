import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuCliTreeProps = { rows: MenuEntry[] };

export function MenuCliTree({ rows }: MenuCliTreeProps) {
  const [active, setActive] = useState(0);
  return (
    <MenuTileShell id="F2" title="CLI · tree" kind="diag">
      <S.MenuCli>
        <S.MenuCliPrompt>$ menu --tree</S.MenuCliPrompt>
        <S.MenuHintDim>menu</S.MenuHintDim>
        <Box>
          {rows.map((entry, i) => {
            const last = i === rows.length - 1;
            const isActive = i === active;
            const Label = isActive ? S.MenuLabelActive : S.MenuLabel;
            return (
              <S.MenuCliBranch key={entry.id} onMouseEnter={() => setActive(i)}>
                <S.MenuCliGlyph>{last ? '└── ' : '├── '}</S.MenuCliGlyph>
                <Label>{entry.label.toLowerCase()}</Label>
                <S.MenuCliHint>— {entry.hint}</S.MenuCliHint>
              </S.MenuCliBranch>
            );
          })}
        </Box>
      </S.MenuCli>
    </MenuTileShell>
  );
}
