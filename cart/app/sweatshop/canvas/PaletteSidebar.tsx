// PaletteSidebar — left rail of the sweatshop canvas.
//
// Three sections (capability / domain / rules). Click an item → caller
// receives the PaletteItem and spawns a node at the canvas center
// (the canvas owns layout, so we don't position here).

import { Col, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { useMemo, useState } from 'react';
import { buildPalette, PALETTE_TIERS, type PaletteItem, type PaletteTier } from './palette';

export type PaletteSidebarProps = {
  onSpawn: (item: PaletteItem) => void;
};

export function PaletteSidebar({ onSpawn }: PaletteSidebarProps) {
  const [tier, setTier] = useState<PaletteTier>('capability');
  const [filter, setFilter] = useState('');
  const items = useMemo(() => buildPalette(), []);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter((it) =>
      it.tier === tier && (!q || it.label.toLowerCase().includes(q) || (it.hint ?? '').toLowerCase().includes(q)),
    );
  }, [items, tier, filter]);

  return (
    <Col style={{
      width: 280,
      backgroundColor: 'theme:bg1',
      borderRightWidth: 1,
      borderRightColor: 'theme:rule',
    }}>
      {/* Tier selector */}
      <Col style={{ padding: 12, gap: 4, borderBottomWidth: 1, borderBottomColor: 'theme:rule' }}>
        {PALETTE_TIERS.map((t) => {
          const active = t.id === tier;
          const Pill = active ? S.NavPillActive : S.NavPill;
          return (
            <Pill key={t.id} onPress={() => setTier(t.id)}>
              <Col style={{ gap: 2 }}>
                <S.Body style={{ fontWeight: active ? 700 : 400, color: active ? 'theme:accent' : 'theme:ink' }}>
                  {t.label}
                </S.Body>
                <S.Caption>{t.hint}</S.Caption>
              </Col>
            </Pill>
          );
        })}
      </Col>

      {/* Filter input is intentionally a button-toggle for now; a real
          search input lands when the canvas itself stops mounting it. */}
      <Col style={{ padding: 8, gap: 4 }}>
        <S.Caption>{filtered.length} items</S.Caption>
      </Col>

      {/* Item list */}
      <ScrollView style={{ flexGrow: 1 }}>
        <Col style={{ padding: 8, gap: 4 }}>
          {filtered.map((it) => (
            <Pressable
              key={it.id}
              onPress={() => onSpawn(it)}
              style={{
                padding: 8,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: 'theme:rule',
                backgroundColor: 'theme:bg2',
                gap: 2,
              }}
            >
              <S.Body>{it.label}</S.Body>
              {it.hint ? <S.Caption>{it.hint}</S.Caption> : null}
            </Pressable>
          ))}
        </Col>
      </ScrollView>
    </Col>
  );
}
