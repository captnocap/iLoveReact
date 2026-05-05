import { useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import type { MenuEntry } from '../../data/overstock/menu-entry';
import { MenuTileShell } from '../menu-tile-shell/MenuTileShell';
import { useTick } from '../../lib/useTick';

// 7 entries arranged on a 7-col × 3-row periodic-table silhouette.
// Empty cells are solid-color tiles tinted by block (s-block left, p-block
// right) with a subtle continuous brightness wave that travels across the
// table — the "periodic easing".

type LiveCell = {
  row: number;
  col: number;
  sym: string;
  mass: string;
  entryIndex: number;
};

const COLS = 7;
const ROWS = 3;

const LIVE: LiveCell[] = [
  { row: 0, col: 0, sym: 'Co', mass: '02.18', entryIndex: 0 },
  { row: 0, col: 6, sym: 'Nw', mass: '00.00', entryIndex: 1 },
  { row: 1, col: 0, sym: 'Ac', mass: '12.0',  entryIndex: 2 },
  { row: 1, col: 1, sym: 'Lb', mass: '114',   entryIndex: 3 },
  { row: 2, col: 0, sym: 'Fr', mass: '04.0',  entryIndex: 4 },
  { row: 2, col: 5, sym: 'St', mass: '—',     entryIndex: 5 },
  { row: 2, col: 6, sym: 'Qt', mass: '00.0',  entryIndex: 6 },
];

const ROMAN: string[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// Block tints — s-block (cols 0–1) cool, p-block (cols 2–6) warm.
const BLOCK_BASE = ['theme:paperInk', 'theme:paperInk', 'theme:paperInk', 'theme:paperInk', 'theme:paperInk', 'theme:paperInk', 'theme:paperInk'];
const BLOCK_BORDER = 'theme:paperRule';

function EmptyTile({ row, col, t }: { row: number; col: number; t: number }) {
  const phase = t * 1.4 - col * 0.55 - row * 0.35;
  const wave = (Math.sin(phase) + 1) / 2; // 0..1
  const opacity = 0.55 + 0.45 * wave;
  return (
    <Box
      style={{
        width: 50, height: 56,
        backgroundColor: BLOCK_BASE[col],
        borderWidth: 1, borderColor: BLOCK_BORDER,
        opacity,
      }}
    />
  );
}

export type MenuPeriodicProps = { rows: MenuEntry[] };

export function MenuPeriodic({ rows }: MenuPeriodicProps) {
  const [active, setActive] = useState(0);
  const t = useTick();
  const cur = rows[active];
  const liveCur = LIVE.find((c) => c.entryIndex === active);

  return (
    <MenuTileShell id="H3" title="Periodic" kind="weird" ratio="square">
      <S.MenuPeriodic>
        {/* Group axis */}
        <S.MenuPeriodicGroupRow>
          {ROMAN.map((g) => (
            <S.MenuPeriodicGroupTick key={g}>
              <S.MenuPeriodicGroupNum numberOfLines={1}>{g}</S.MenuPeriodicGroupNum>
            </S.MenuPeriodicGroupTick>
          ))}
        </S.MenuPeriodicGroupRow>

        {/* Table */}
        <S.MenuPeriodicTable>
          {Array.from({ length: ROWS }).map((_, row) => (
            <S.MenuPeriodicTableRow key={`row-${row}`}>
              <S.MenuPeriodicPeriodTick>
                <S.MenuPeriodicPeriodNum numberOfLines={1}>{row + 1}</S.MenuPeriodicPeriodNum>
              </S.MenuPeriodicPeriodTick>
              {Array.from({ length: COLS }).map((__, col) => {
                const live = LIVE.find((c) => c.row === row && c.col === col);
                if (!live) {
                  return <EmptyTile key={`${row}-${col}`} row={row} col={col} t={t} />;
                }
                const entry = rows[live.entryIndex];
                if (!entry) return null;
                const isActive = live.entryIndex === active;
                const Cell = isActive ? S.MenuPeriodicCellActive : S.MenuPeriodicCellLive;
                const Sym = isActive ? S.MenuPeriodicSymActive : S.MenuPeriodicSym;
                const Name = isActive ? S.MenuPeriodicNameActive : S.MenuPeriodicName;
                const num = row * COLS + col + 1;
                return (
                  <Cell key={`${row}-${col}`} onMouseEnter={() => setActive(live.entryIndex)}>
                    <S.MenuPeriodicCellHead>
                      <S.MenuPeriodicNum numberOfLines={1}>{num}</S.MenuPeriodicNum>
                      <S.MenuPeriodicMass numberOfLines={1}>{live.mass}</S.MenuPeriodicMass>
                    </S.MenuPeriodicCellHead>
                    <S.MenuPeriodicSymRow>
                      <Sym numberOfLines={1}>{live.sym}</Sym>
                    </S.MenuPeriodicSymRow>
                    <Name numberOfLines={1}>{entry.label.toUpperCase()}</Name>
                  </Cell>
                );
              })}
            </S.MenuPeriodicTableRow>
          ))}
        </S.MenuPeriodicTable>

        {/* Featured element strip */}
        <S.MenuPeriodicFeature>
          <S.MenuPeriodicFeatureSym>
            <S.MenuPeriodicCellHead>
              <S.MenuPeriodicNum numberOfLines={1}>{liveCur ? liveCur.row * COLS + liveCur.col + 1 : '—'}</S.MenuPeriodicNum>
              <S.MenuPeriodicMass numberOfLines={1}>{liveCur?.mass ?? ''}</S.MenuPeriodicMass>
            </S.MenuPeriodicCellHead>
            <S.MenuPeriodicSymRow>
              <S.MenuPeriodicSymActive numberOfLines={1}>{liveCur?.sym ?? ''}</S.MenuPeriodicSymActive>
            </S.MenuPeriodicSymRow>
          </S.MenuPeriodicFeatureSym>
          <S.MenuPeriodicFeatureMain>
            <S.MenuEyebrow numberOfLines={1}>SELECTED · {String(active + 1).padStart(2, '0')}</S.MenuEyebrow>
            <S.MenuLabelStrong numberOfLines={1}>{cur?.label ?? ''}</S.MenuLabelStrong>
            <S.MenuHint numberOfLines={1}>{cur?.hint ?? ''}</S.MenuHint>
          </S.MenuPeriodicFeatureMain>
          <Box style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 96, flexShrink: 0 }}>
            <S.MenuHintDim numberOfLines={1}>GROUP · {liveCur ? ROMAN[liveCur.col] : '—'}</S.MenuHintDim>
            <S.MenuHintDim numberOfLines={1}>PERIOD · {liveCur ? liveCur.row + 1 : '—'}</S.MenuHintDim>
          </Box>
        </S.MenuPeriodicFeature>
      </S.MenuPeriodic>
    </MenuTileShell>
  );
}
