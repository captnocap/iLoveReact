import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';
import { useTick } from '../../lib/useTick';

const ITEM_W = 160;       // matches MenuMarqueeItem width
const SPEED = 60;         // px / second

export type MenuMarqueeProps = { rows: MenuEntry[] };

export function MenuMarquee({ rows }: MenuMarqueeProps) {
  const [active, setActive] = useState(0);
  const t = useTick();
  const cur = rows[active];
  const loopW = ITEM_W * rows.length;
  const offset = -((t * SPEED) % loopW);
  const strip = [...rows, ...rows]; // duplicated for seamless loop

  return (
    <MenuTileShell id="D4" title="Marquee ticker" kind="rail">
      <S.MenuMarquee>
        <S.MenuEyebrow>NOW · {String(active + 1).padStart(2, '0')} / {String(rows.length).padStart(2, '0')}</S.MenuEyebrow>
        <S.MenuPreviewTitle>{cur?.label ?? ''}</S.MenuPreviewTitle>
        <S.MenuHint>{cur?.hint ?? ''}</S.MenuHint>
        <Box style={{ flex: 1 }} />
        <S.MenuMarqueeTrack>
          <Box style={{ position: 'absolute', top: 0, bottom: 0, left: offset, flexDirection: 'row', alignItems: 'center' }}>
            {strip.map((entry, i) => {
              const idx = i % rows.length;
              const isActive = idx === active;
              const Label = isActive ? S.MenuLabelActive : S.MenuHint;
              return (
                <S.MenuMarqueeItem key={`${entry.id}-${i}`} onMouseEnter={() => setActive(idx)}>
                  <S.MenuNumAccent>◆</S.MenuNumAccent>
                  <Label>{entry.label.toUpperCase()}</Label>
                </S.MenuMarqueeItem>
              );
            })}
          </Box>
        </S.MenuMarqueeTrack>
      </S.MenuMarquee>
    </MenuTileShell>
  );
}
