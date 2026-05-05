import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';

export type MenuDossierProps = { rows: MenuEntry[] };

export function MenuDossier({ rows }: MenuDossierProps) {
  const [active, setActive] = useState(0);
  const center = (rows.length - 1) / 2;

  const BASE_LEFT = 56;
  const BASE_TOP = 44;
  return (
    <MenuTileShell id="E1" title="Dossier fan" kind="card">
      <S.MenuDossier>
        {rows.map((entry, i) => {
          const isActive = i === active;
          const angle = (i - center) * 8;
          const rotate = isActive ? 0 : angle;
          const tx = isActive ? 0 : i * 6;
          const ty = isActive ? -16 : i * 4;
          const Card = isActive ? S.MenuDossierCardActive : S.MenuDossierCard;
          return (
            <Box
              key={entry.id}
              style={{
                position: 'absolute',
                left: BASE_LEFT + tx,
                top: BASE_TOP + ty,
                zIndex: isActive ? 100 : i,
                transform: { rotate },
              }}
            >
              <Card onMouseEnter={() => setActive(i)}>
                <Box style={{ gap: 6 }}>
                  <S.MenuNumAccent>FILE · 0{i + 1}</S.MenuNumAccent>
                  <S.MenuDossierTitle>{entry.label}</S.MenuDossierTitle>
                </Box>
                <S.MenuHint>{entry.hint}</S.MenuHint>
              </Card>
            </Box>
          );
        })}
      </S.MenuDossier>
    </MenuTileShell>
  );
}
