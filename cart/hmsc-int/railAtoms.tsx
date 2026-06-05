import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { busOn } from '@reactjit/hooks/useIFTTT';

export const RAIL_CELL = 24;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function ToolBtn(props: { icon: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ width: RAIL_CELL, height: RAIL_CELL, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: props.active ? '#f8fafc' : '#334155', backgroundColor: props.active ? '#1e293b' : '#0f1a2e' }}>
      <Icon name={props.icon} size={14} color={props.active ? '#f8fafc' : '#94a3b8'} />
    </Pressable>
  );
}

export function StepBtn(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 3, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
      <Text fontSize={11} color="#cbd5e1">{props.label}</Text>
    </Pressable>
  );
}

export function MiniStepper(props: { label: string; value: string; onDec: () => void; onInc: () => void }) {
  return (
    <Box style={{ gap: 3 }}>
      <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{props.label}</Text>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        <StepBtn label="-" onPress={props.onDec} />
        <Box style={{ flexGrow: 1, alignItems: 'center', borderWidth: 1, borderColor: '#27364a', borderRadius: 3, paddingTop: 3, paddingBottom: 3, backgroundColor: '#0f1a2e' }}>
          <Text fontSize={9} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{props.value}</Text>
        </Box>
        <StepBtn label="+" onPress={props.onInc} />
      </Box>
    </Box>
  );
}

export function Swatch(props: { color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ width: RAIL_CELL, height: RAIL_CELL, borderRadius: 3, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#f8fafc' : '#1e293b', backgroundColor: props.color }} />
  );
}

export function ChipGrid(props: {
  items: ReadonlyArray<{ id: string; label: string; hint: string }>;
  value: string;
  onPick: (id: string) => void;
  dim?: boolean;
}) {
  return (
    <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, opacity: props.dim ? 0.4 : 1 }}>
      {props.items.map((it) => {
        const active = props.value === it.id;
        return (
          <Pressable key={it.id} onPress={() => props.onPick(it.id)} style={{ width: '48%', alignItems: 'center', paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: active ? '#f8fafc' : '#334155', backgroundColor: active ? '#1e293b' : '#0f1a2e' }}>
            <Text fontSize={11} color={active ? '#7dd3fc' : '#64748b'}>{it.hint}</Text>
            <Text fontSize={7} color={active ? '#f8fafc' : '#94a3b8'} style={{ fontFamily: 'monospace' }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </Box>
  );
}

export function RailLabel(props: { text: string }) {
  return <Text fontSize={7} color="#64748b" style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}>{props.text}</Text>;
}

export function LayerBtn(props: { label: string; color: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 5, borderRadius: 5, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#f8fafc' : '#27364a', backgroundColor: props.active ? '#1e293b' : '#0b1320' }}>
      <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: props.color }} />
      <Text fontSize={10} color={props.active ? '#f8fafc' : '#94a3b8'} style={{ fontWeight: props.active ? 700 : 600, letterSpacing: 1 }}>{props.label}</Text>
    </Pressable>
  );
}

export function RailSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onValue: (n: number) => void;
  step?: number;
  valueText?: string;
  formatDraft?: (n: number) => string;
  inputWidth?: number;
}) {
  const trackRef = useRef<{ x: number; width: number }>({ x: 0, width: 1 });
  const draggingRef = useRef(false);
  const dragValueRef = useRef(props.value);
  const valueRef = useRef(props.value);
  const onValueRef = useRef(props.onValue);
  const step = props.step ?? 1;
  const formatDraft = props.formatDraft ?? String;
  valueRef.current = props.value;
  onValueRef.current = props.onValue;
  const [draft, setDraft] = useState(formatDraft(props.value));
  useEffect(() => setDraft(formatDraft(props.value)), [props.value]);

  const snap = (n: number) => {
    const s = step > 0 ? step : 1;
    const snapped = props.min + Math.round((n - props.min) / s) * s;
    return clamp(snapped, props.min, props.max);
  };

  useEffect(() => busOn('system:cursor:move', (e: any) => {
    if (!draggingRef.current) return;
    const width = Math.max(1, trackRef.current.width);
    dragValueRef.current += Number(e?.dx ?? 0) / width * (props.max - props.min);
    onValueRef.current(snap(dragValueRef.current));
  }), [props.min, props.max, step]);

  const setFromX = (sx: number) => {
    const rect = trackRef.current;
    const raw = (sx - rect.x) / Math.max(1, rect.width);
    dragValueRef.current = props.min + clamp(raw, 0, 1) * (props.max - props.min);
    props.onValue(snap(dragValueRef.current));
  };
  const typed = (s: string) => {
    setDraft(s);
    const n = Number(s);
    if (Number.isFinite(n)) props.onValue(snap(n));
  };
  const span = Math.max(1, props.max - props.min);
  const pct = clamp((props.value - props.min) / span, 0, 1);
  const visualW = 132;

  return (
    <Box style={{ gap: 4 }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <RailLabel text={props.label} />
        <Box style={{ flexGrow: 1 }} />
        {props.valueText ? <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{props.valueText}</Text> : null}
        <TextInput text={draft} onChangeText={typed} style={{ width: props.inputWidth ?? 34, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#27364a', borderRadius: 3, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }} />
      </Box>
      <Pressable
        onMouseDown={(p: any) => { draggingRef.current = true; dragValueRef.current = valueRef.current; setFromX(Number(p?.x ?? 0)); }}
        onMouseUp={() => { draggingRef.current = false; }}
      >
        <Box onLayout={(r: any) => { trackRef.current = { x: Number(r?.x ?? 0), width: Number(r?.width ?? 1) }; }} style={{ width: visualW, height: 20, borderRadius: 5, backgroundColor: '#0b1424', borderWidth: 1, borderColor: '#1e293b', position: 'relative', justifyContent: 'center' }}>
          <Box style={{ position: 'absolute', left: 6, right: 6, top: 9, height: 2, borderRadius: 1, backgroundColor: '#334155' }} />
          <Box style={{ position: 'absolute', left: 6, top: 9, width: Math.max(2, Math.round((visualW - 12) * pct)), height: 2, borderRadius: 1, backgroundColor: '#38bdf8' }} />
          <Box style={{ position: 'absolute', left: 2 + Math.round((visualW - 16) * pct), top: 3, width: 14, height: 14, borderRadius: 7, backgroundColor: '#38bdf8', borderWidth: 2, borderColor: '#0a111d' }} />
        </Box>
      </Pressable>
    </Box>
  );
}

export function SizeSlider(props: {
  size: number;
  min: number;
  max: number;
  onSize: (n: number) => void;
}) {
  return (
    <RailSlider
      label="radius"
      value={props.size}
      min={props.min}
      max={props.max}
      step={1}
      valueText={`${props.size * 2 + 1}t`}
      onValue={(n) => props.onSize(Math.round(n))}
    />
  );
}
