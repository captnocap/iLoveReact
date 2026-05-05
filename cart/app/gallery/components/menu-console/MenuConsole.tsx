import { useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuConsoleProps = { rows: MenuEntry[] };

export function MenuConsole({ rows }: MenuConsoleProps) {
  const [active, setActive] = useState(0);
  const cells = rows.slice(0, 6);
  const ROWS: number[][] = [[0, 1], [2, 3], [4, 5]];

  return (
    <MenuTileShell id="G3" title="Control panel" kind="diegetic">
      <S.MenuConsole>
        {ROWS.map((line, r) => (
          <S.MenuConsoleRow key={`row-${r}`}>
            {line.map((i) => {
              const entry = cells[i];
              if (!entry) return null;
              const isActive = i === active;
              const Cell = isActive ? S.MenuConsoleCellActive : S.MenuConsoleCell;
              const Led = isActive ? S.MenuLedActive : S.MenuLed;
              const Label = isActive ? S.MenuLabelActive : S.MenuLabelStrong;
              return (
                <Cell key={entry.id} onMouseEnter={() => setActive(i)}>
                  <S.MenuConsoleHead>
                    <Led />
                    <S.MenuHintDim>CH·{String(i + 1).padStart(2, '0')}</S.MenuHintDim>
                  </S.MenuConsoleHead>
                  <Label>{entry.label.toUpperCase()}</Label>
                  <S.MenuHint>{entry.hint}</S.MenuHint>
                </Cell>
              );
            })}
          </S.MenuConsoleRow>
        ))}
      </S.MenuConsole>
    </MenuTileShell>
  );
}
