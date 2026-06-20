// TargetDock — the painter's channel dock (PAINTER-0610, req_0593).
//
// Replaces the old bottom layer switch. The author is always in the SAME
// Painter; a chip picks what the brush currently edits (the active target),
// and each chip's eye shows/hides that channel as a dim landmark while
// something else is active. Persisted Layer VALUES are unchanged — only the
// labels speak the target language (paint→TILE, height→TERRAIN, place→OBJECT).

import { Box, Pressable, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import type { Layer } from './PaintCanvas';

/** Per-channel visibility; ABSENT = visible (older saved maps parse as all-on). */
export type PainterChannels = Partial<Record<Layer, boolean>>;

export function channelVisible(channels: PainterChannels | undefined, layer: Layer): boolean {
  return channels?.[layer] !== false;
}

const TARGETS: { layer: Layer; label: string; color: string; eye: boolean }[] = [
  { layer: 'paint', label: 'TILE', color: '#86efac', eye: false }, // tiles are the base — always visible
  { layer: 'flora', label: 'FLORA', color: '#4ade80', eye: true },
  { layer: 'water', label: 'WATER', color: '#2f7fa8', eye: false },
  { layer: 'road', label: 'ROAD', color: '#f59e0b', eye: true },
  { layer: 'height', label: 'TERRAIN', color: '#fbbf24', eye: true },
  { layer: 'place', label: 'OBJECT', color: '#a78bfa', eye: true },
  { layer: 'zone', label: 'ZONE', color: '#22d3ee', eye: true },
];

export function TargetDock(props: {
  layer: Layer;
  onLayer: (l: Layer) => void;
  channels: PainterChannels;
  onToggleChannel: (l: Layer) => void;
}) {
  return (
    <Box style={{ flexDirection: 'row', gap: 4 }}>
      {TARGETS.map((t) => {
        const active = props.layer === t.layer;
        const visible = active || channelVisible(props.channels, t.layer); // the active channel can't hide
        return (
          <Box key={t.layer} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 5, borderWidth: active ? 2 : 1, borderColor: active ? '#f8fafc' : '#27364a', backgroundColor: active ? '#1e293b' : '#0b1320' }}>
            <Pressable onPress={() => props.onLayer(t.layer)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 5, paddingTop: 5, paddingBottom: 5 }}>
              <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: visible ? t.color : '#334155' }} />
              <Text fontSize={10} color={active ? '#f8fafc' : visible ? '#94a3b8' : '#475569'} style={{ fontWeight: active ? 700 : 600, letterSpacing: 1 }}>{t.label}</Text>
            </Pressable>
            {t.eye ? (
              <Pressable onPress={active ? () => {} : () => props.onToggleChannel(t.layer)} style={{ paddingLeft: 2, paddingRight: 7, paddingTop: 5, paddingBottom: 5, opacity: active ? 0.35 : 1 }}>
                <Icon name={visible ? 'Eye' : 'EyeOff'} size={11} color={visible ? '#94a3b8' : '#475569'} />
              </Pressable>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
