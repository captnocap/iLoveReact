import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuTerminalProps = { rows: MenuEntry[] };

export function MenuTerminal({ rows }: MenuTerminalProps) {
  const [active, setActive] = useState(0);
  const cur = rows[active];
  return (
    <MenuTileShell id="G2" title="Terminal prompt" kind="diegetic">
      <S.MenuTerm>
        <S.MenuTermLine>menu v3.7 · operator: lock · session 04.27.26</S.MenuTermLine>
        <S.MenuTermLineOk>[ok] welcome back, operator.</S.MenuTermLineOk>
        <S.MenuTermLine>type the number, or use ↑↓ + ↵</S.MenuTermLine>
        <S.MenuTermPrompt>
          <S.MenuLabelActive>$ menu &gt; </S.MenuLabelActive>
          <S.MenuLabel>{cur?.id ?? ''}</S.MenuLabel>
          <S.MenuTermCursor />
        </S.MenuTermPrompt>
        <Box style={{ gap: 2, marginTop: 6 }}>
          {rows.map((entry, i) => {
            const isActive = i === active;
            const Opt = isActive ? S.MenuTermOptActive : S.MenuTermOpt;
            const Label = isActive ? S.MenuLabelActive : S.MenuLabel;
            return (
              <Opt key={entry.id} onMouseEnter={() => setActive(i)}>
                {isActive ? <S.MenuCaret>&gt;</S.MenuCaret> : null}
                <S.MenuKey>[{entry.key}]</S.MenuKey>
                <Box style={{ flex: 1 }}>
                  <Label>{entry.label.toLowerCase()}</Label>
                </Box>
                <S.MenuHintDim>--{entry.id}</S.MenuHintDim>
              </Opt>
            );
          })}
        </Box>
      </S.MenuTerm>
    </MenuTileShell>
  );
}
