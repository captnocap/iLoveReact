import { useState } from 'react';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuTypeStackProps = { rows: MenuEntry[] };

export function MenuTypeStack({ rows }: MenuTypeStackProps) {
  const [active, setActive] = useState(0);
  return (
    <MenuTileShell id="H5" title="Type stack" kind="weird">
      <S.MenuTypeStack>
        <S.MenuEyebrow>MENU — 04.27.26</S.MenuEyebrow>
        <S.MenuTypeStackBody>
          {rows.map((entry, i) => {
            const isActive = i === active;
            const Row = isActive ? S.MenuTypeRowActive : S.MenuTypeRow;
            const Text = isActive ? S.MenuTypeTextActive : S.MenuTypeText;
            return (
              <Row key={entry.id} onMouseEnter={() => setActive(i)}>
                {isActive ? <S.MenuTypeBar /> : null}
                <Text>{entry.label}</Text>
                {isActive ? <S.MenuTypeHint>— {entry.hint}</S.MenuTypeHint> : null}
              </Row>
            );
          })}
        </S.MenuTypeStackBody>
      </S.MenuTypeStack>
    </MenuTileShell>
  );
}
