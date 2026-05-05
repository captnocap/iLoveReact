// PaletteSidebar — left rail of the sweatshop canvas.
//
// Three sections (capability / domain / rules). Click an item → caller
// receives the PaletteItem and spawns a node at the canvas center
// (the canvas owns layout, so we don't position here).

import { Box, Col, Pressable, ScrollView, Text } from '@reactjit/runtime/primitives';
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
      backgroundColor: 'theme:surface',
      borderRightWidth: 1,
      borderRightColor: 'theme:line',
    }}>
      {/* Tier selector */}
      <Col style={{ padding: 12, gap: 4, borderBottomWidth: 1, borderBottomColor: 'theme:lineSoft' }}>
        {PALETTE_TIERS.map((t) => {
          const active = t.id === tier;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTier(t.id)}
              style={{
                padding: 8,
                borderRadius: 6,
                backgroundColor: active ? 'theme:accentSoft' : 'transparent',
              }}
            >
              <Text size={12} color={active ? 'theme:accent' : 'theme:ink'} bold={active}>{t.label}</Text>
              <Text size={10} color="theme:inkMuted">{t.hint}</Text>
            </Pressable>
          );
        })}
      </Col>

      {/* Filter input is intentionally a button-toggle for now; a real
          search input lands when the canvas itself stops mounting it. */}
      <Col style={{ padding: 8, gap: 4 }}>
        <Text size={10} color="theme:inkMuted">{filtered.length} items</Text>
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
                borderColor: 'theme:lineSoft',
                gap: 2,
              }}
            >
              <Text size={11} color="theme:ink">{it.label}</Text>
              {it.hint ? <Text size={9} color="theme:inkMuted">{it.hint}</Text> : null}
            </Pressable>
          ))}
        </Col>
      </ScrollView>
    </Col>
  );
}
