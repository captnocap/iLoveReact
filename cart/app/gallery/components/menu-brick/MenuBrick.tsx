import { useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuBrickProps = { rows: MenuEntry[] };

const ROWS: number[][] = [
  [0, 1, 2],
  [3, 4],
  [5, 6],
];

export function MenuBrick({ rows }: MenuBrickProps) {
  const [active, setActive] = useState(0);
  return (
    <MenuTileShell id="C3" title="Brick · expand-on-hover" kind="grid">
      <S.MenuGridBox>
        {ROWS.map((line, r) => {
          const Row = r === 1 ? S.MenuBrickRowOffset : S.MenuBrickRow;
          return (
            <Row key={`row-${r}`}>
              {line.map((i) => {
                const entry = rows[i];
                if (!entry) return null;
                const isActive = i === active;
                const Brick = isActive ? S.MenuBrickActive : S.MenuBrick;
                const Label = isActive ? S.MenuLabelActive : S.MenuLabel;
                return (
                  <Brick key={entry.id} onMouseEnter={() => setActive(i)}>
                    <Label>{entry.label.toUpperCase()}</Label>
                  </Brick>
                );
              })}
            </Row>
          );
        })}
      </S.MenuGridBox>
    </MenuTileShell>
  );
}
