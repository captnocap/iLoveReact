import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuBarcodeProps = { rows: MenuEntry[] };

export function MenuBarcode({ rows }: MenuBarcodeProps) {
  const [active, setActive] = useState(0);
  const cur = rows[active];
  return (
    <MenuTileShell id="H2" title="Barcode" kind="weird">
      <S.MenuBarcode>
        <S.MenuHintDim>MENU · 0427 · OPERATOR</S.MenuHintDim>
        <S.MenuBarcodeStrip>
          {rows.map((entry, i) => {
            const isActive = i === active;
            const Bar = isActive ? S.MenuBarcodeBarActive : S.MenuBarcodeBar;
            const Label = isActive ? S.MenuBarcodeLabelActive : S.MenuBarcodeLabel;
            return (
              <Bar key={entry.id} onMouseEnter={() => setActive(i)}>
                <Box
                  style={{
                    position: 'absolute',
                    left: 0, right: 0, bottom: 12,
                    alignItems: 'center',
                  }}
                >
                  <Box style={{ transform: { rotate: -90 } }}>
                    <Label>{entry.label.toUpperCase()}</Label>
                  </Box>
                </Box>
              </Bar>
            );
          })}
        </S.MenuBarcodeStrip>
        <S.MenuBarcodeFoot>
          <S.MenuHint>0 427 26 — {String(active + 1).padStart(2, '0')}</S.MenuHint>
          <S.MenuHint>{cur ? `${cur.label.toUpperCase()} · ${cur.hint.toUpperCase()}` : ''}</S.MenuHint>
        </S.MenuBarcodeFoot>
      </S.MenuBarcode>
    </MenuTileShell>
  );
}
