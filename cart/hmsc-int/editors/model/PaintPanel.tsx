// editors/model/PaintPanel.tsx — the floating PAINT controls (req_1297). Moved out
// of the top toolbar (which was overcrowded) into a compact panel shown only in paint
// mode. Primary path is NORMAL flat COLOURS: a swatch row + a custom-colour wheel —
// most faces are just one colour. Materials (world-scaled) and the recolour variant
// are secondary, in the same panel.

import { useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { ColorWheel } from '../paint/ColorWheel';
import { slotById, type Palette } from './modelStream';

const SW = 19; // swatch size

export function PaintPanel(props: {
  palette: Palette;
  activeSlot: number;
  erase: boolean;
  view: 'pseudo' | 'painted';
  brush: number;
  brushSizes: number[];
  cell: number;
  onSetCell: (n: number) => void;
  fill: boolean;
  onToggleFill: () => void;
  onPickSlot: (id: number) => void;
  onAddColor: (hex: string) => void;
  onToggleErase: () => void;
  onToggleView: () => void;
  onSetBrush: (n: number) => void;
  onCycleVariant: () => void;
  onClear: () => void;
}) {
  const [pick, setPick] = useState(false);
  const [hex, setHex] = useState('#c64b53');
  const colors = props.palette.slots.filter((s) => s.kind === 'color');
  const mats = props.palette.slots.filter((s) => s.kind === 'material');
  // the recolour variant only matters when a slot carries more than one colour.
  const multiVariant = props.palette.slots.some((s) => s.kind === 'color' && (s.colors?.length ?? 1) > 1);
  const activeIsColor = slotById(props.palette, props.activeSlot)?.kind === 'color';

  const Tiny = (p: { label: string; on?: boolean; danger?: boolean; tip: string; onPress: () => void }) => (
    <Pressable onPress={p.onPress} tooltip={p.tip} style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 4, paddingBottom: 4, borderRadius: 5, backgroundColor: p.on ? '#2a3f5e' : '#13233aee', borderWidth: 1, borderColor: p.danger ? '#a14545' : p.on ? '#5b8fd6' : '#2c4a6a' }}>
      <Text fontSize={10} color={p.danger ? '#f0a0a0' : p.on ? '#cfe2ff' : '#7f93b1'} style={{ fontFamily: 'monospace' }}>{p.label}</Text>
    </Pressable>
  );

  return (
    <Box style={{ position: 'absolute', left: 8, top: 84, width: 214, padding: 9, gap: 9, borderRadius: 9, backgroundColor: '#0a111cf2', borderWidth: 1, borderColor: '#1c2940' }}>
      {/* COLOURS — the common case: pick a swatch (or a custom colour) and paint flat. */}
      <Box style={{ gap: 6 }}>
        <Text fontSize={9} color="#6f819c" style={{ fontFamily: 'monospace', letterSpacing: 1 }}>COLOURS</Text>
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {colors.map((s) => {
            const on = !props.erase && props.activeSlot === s.id;
            const col = (s.colors && s.colors[props.palette.variant % s.colors.length]) || s.pseudo;
            return <Pressable key={s.id} onPress={() => props.onPickSlot(s.id)} tooltip={`${s.name}`} style={{ width: SW, height: SW, borderRadius: 4, backgroundColor: col, borderWidth: on ? 2 : 1, borderColor: on ? '#ffffff' : '#0008' }} />;
          })}
          {/* custom colour — opens the wheel; "Use" mints a swatch + selects it. */}
          <Pressable onPress={() => setPick(!pick)} tooltip="Custom colour — pick any colour" style={{ width: SW, height: SW, borderRadius: 4, backgroundColor: '#13233aee', borderWidth: 1, borderColor: '#2c4a6a', alignItems: 'center', justifyContent: 'center' }}>
            <Text fontSize={12} color="#7f93b1" style={{ fontFamily: 'monospace' }}>+</Text>
          </Pressable>
        </Box>
        {pick ? (
          <Box style={{ gap: 6, alignItems: 'center' }}>
            <ColorWheel value={hex} onChange={setHex} size={120} />
            <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Box style={{ width: SW, height: SW, borderRadius: 4, backgroundColor: hex, borderWidth: 1, borderColor: '#0008' }} />
              <Tiny label={`use ${hex}`} tip="Add this colour as a swatch and paint with it" onPress={() => { props.onAddColor(hex); setPick(false); }} />
            </Box>
          </Box>
        ) : null}
      </Box>

      {/* MATERIALS — world-scaled procedural fills (secondary). */}
      {mats.length ? (
        <Box style={{ gap: 6 }}>
          <Text fontSize={9} color="#6f819c" style={{ fontFamily: 'monospace', letterSpacing: 1 }}>MATERIALS</Text>
          <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {mats.map((s) => {
              const on = !props.erase && props.activeSlot === s.id;
              return (
                <Pressable key={s.id} onPress={() => props.onPickSlot(s.id)} tooltip={`${s.name} (material)`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 5, paddingRight: 7, height: SW, borderRadius: 4, backgroundColor: on ? '#2a3f5e' : '#13233aee', borderWidth: on ? 2 : 1, borderColor: on ? '#ffffff' : '#2c4a6a' }}>
                  <Box style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: s.pseudo }} />
                  <Text fontSize={10} color={on ? '#cfe2ff' : '#7f93b1'} style={{ fontFamily: 'monospace' }}>{s.name}</Text>
                </Pressable>
              );
            })}
          </Box>
        </Box>
      ) : null}

      {/* BRUSH + fill + erase */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <Text fontSize={9} color="#6f819c" style={{ fontFamily: 'monospace' }}>brush</Text>
        {props.brushSizes.map((n) => <Tiny key={n} label={`${n}`} on={!props.fill && props.brush === n} tip={`Brush radius ${n}`} onPress={() => props.onSetBrush(n)} />)}
        <Tiny label="fill" on={props.fill} tip="Fill the WHOLE face one colour per click (paint a face flat)" onPress={props.onToggleFill} />
        <Tiny label="erase" on={props.erase} tip="Eraser — remove cells under the brush" onPress={props.onToggleErase} />
      </Box>

      {/* DETAIL — the paint cell size (model units). Finer = more cells per face, so
          brush-1 is a smaller dab on a small prop. Best set before painting a part. */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <Text fontSize={9} color="#6f819c" style={{ fontFamily: 'monospace' }}>detail</Text>
        {([['fine', 0.12], ['med', 0.25], ['coarse', 0.6], ['XL', 1.5]] as const).map(([label, n]) => (
          <Tiny key={label} label={label} on={Math.abs(props.cell - n) < 1e-3} tip={`Cell ≈ ${(n / 16 * 100).toFixed(1)} cm — finer = more cells per face (set before painting)`} onPress={() => props.onSetCell(n)} />
        ))}
      </Box>

      {/* view + variant + clear */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
        <Tiny label={props.view === 'pseudo' ? 'pseudo' : 'painted'} tip="Toggle the colourless slot view vs the painted view" onPress={props.onToggleView} />
        {multiVariant ? <Tiny label={`variant ${props.palette.variant + 1}`} on={activeIsColor} tip="Recolour — cycle the palette variant (multi-colour slots)" onPress={props.onCycleVariant} /> : null}
        <Tiny label="clear" danger tip="Clear all paint on this model" onPress={props.onClear} />
      </Box>
    </Box>
  );
}
