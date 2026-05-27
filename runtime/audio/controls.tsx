const React = require('react');

import { AUDIO_SOUND, type AudioSound, type AudioParamDefinition, useAudio } from './';
import { Box, Text, Pressable, TextInput } from '../primitives';
import { useInterval } from '../hooks/useInterval';

type ControlEvent = {
  defaultPrevented: boolean;
  preventDefault: () => void;
};

type KeybedLayout = 'piano' | 'grid';
type PadMode = 'trigger' | 'toggle' | 'hold';
type SliderProperty = 'volume' | 'pan' | 'param';
type SliderOrientation = 'vertical' | 'horizontal' | 'rotary';
export type PatternStepLevel = 0 | 1 | 2;
export type PatternTrackStep = PatternStepLevel | number;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const STEP_TOKENS = '0123456789ABCDEF';

function controlEvent(): ControlEvent {
  return {
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function quantize(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function noteName(note: number): string {
  const idx = ((note % 12) + 12) % 12;
  return `${NOTE_NAMES[idx]}${Math.floor(note / 12) - 1}`;
}

function isBlackKey(note: number): boolean {
  return [1, 3, 6, 8, 10].includes(((note % 12) + 12) % 12);
}

function normalizeHostPattern(pattern: string, sounds: AudioSound | readonly number[]): string {
  const multi = Array.isArray(sounds) && sounds.length > 1;
  return pattern.split('').map((char) => {
    if (char === '-' || char === '+') return char;
    if (char === 'X' || char === 'x') return multi ? '0' : '0';
    if (STEP_TOKENS.includes(char.toUpperCase())) return char.toUpperCase();
    return '-';
  }).join('');
}

function cyclePatternLevel(level: PatternTrackStep, levels: number): PatternStepLevel {
  const max = Math.max(2, Math.min(3, Math.floor(levels || 3)));
  const next = Math.max(0, Math.min(max - 1, Math.floor(Number(level) || 0))) + 1;
  return (next >= max ? 0 : next) as PatternStepLevel;
}

function patternStringFromSteps(steps: readonly PatternTrackStep[]): string {
  return steps.map((level) => Number(level) > 0 ? '0' : '-').join('');
}

function valueFromPointer(event: any, rect: any, min: number, max: number, orientation: SliderOrientation): number | null {
  if (!rect || typeof event?.x !== 'number' || typeof event?.y !== 'number') return null;
  const horizontal = orientation === 'horizontal';
  const size = Math.max(1, horizontal ? rect.width : rect.height);
  const offset = horizontal ? event.x - rect.x : rect.y + rect.height - event.y;
  return min + clamp(offset / size, 0, 1) * (max - min);
}

function SmallButton({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        minWidth: 34,
        paddingTop: 7,
        paddingBottom: 7,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 7,
        backgroundColor: active ? '#f2b03b' : '#1f2933',
        borderWidth: 1,
        borderColor: active ? '#fde68a' : '#374151',
        alignItems: 'center',
      }}
    >
      <Text fontSize={9} color={active ? '#121212' : '#edf2f7'}>{label}</Text>
    </Pressable>
  );
}

export function Keybed({
  target,
  range = [36, 72],
  layout = 'piano',
  velocity = true,
  sustain = false,
  onNoteOn,
  onNoteOff,
}: {
  target: string;
  range?: [number, number];
  layout?: KeybedLayout;
  velocity?: boolean;
  sustain?: boolean;
  onNoteOn?: (note: number, velocity: number, event?: ControlEvent) => void;
  onNoteOff?: (note: number, event?: ControlEvent) => void;
}) {
  const audio = useAudio();
  const latchedRef = React.useRef<Set<number>>(new Set());
  const activeRef = React.useRef<Set<number>>(new Set());
  const low = Math.floor(range[0] ?? 36);
  const high = Math.max(low + 1, Math.floor(range[1] ?? 72));
  const notes = Array.from({ length: high - low }, (_, i) => low + i);

  React.useEffect(() => {
    if (sustain) return;
    for (const note of latchedRef.current) audio.noteOff(target, note);
    latchedRef.current.clear();
  }, [sustain, target]);

  React.useEffect(() => () => {
    for (const note of latchedRef.current) audio.noteOff(target, note);
    latchedRef.current.clear();
  }, [target]);

  const noteDown = (note: number, payload?: any): void => {
    const ev = controlEvent();
    if (sustain && latchedRef.current.has(note)) {
      onNoteOff?.(note, ev);
      if (!ev.defaultPrevented) audio.noteOff(target, note);
      latchedRef.current.delete(note);
      return;
    }
    if (!sustain && activeRef.current.has(note)) return;
    const v = velocity ? clamp(Number(payload?.pressure ?? 1) || 1, 0, 1) : 1;
    onNoteOn?.(note, v, ev);
    if (!ev.defaultPrevented) audio.noteOn(target, note, v);
    if (sustain) latchedRef.current.add(note);
    else activeRef.current.add(note);
  };

  const noteUp = (note: number): void => {
    if (sustain || !activeRef.current.has(note)) return;
    const ev = controlEvent();
    onNoteOff?.(note, ev);
    if (!ev.defaultPrevented) audio.noteOff(target, note);
    activeRef.current.delete(note);
  };

  const keyStyle = (note: number): Record<string, any> => {
    const black = isBlackKey(note);
    if (layout === 'grid') {
      return {
        width: 44,
        height: 38,
        borderRadius: 6,
        backgroundColor: black ? '#27313d' : '#edf2f7',
        borderWidth: 1,
        borderColor: black ? '#111827' : '#cbd5e1',
        alignItems: 'center',
        justifyContent: 'center',
      };
    }
    return {
      width: black ? 24 : 30,
      height: black ? 74 : 108,
      borderRadius: 5,
      backgroundColor: black ? '#111827' : '#f8fafc',
      borderWidth: 1,
      borderColor: black ? '#020617' : '#cbd5e1',
      alignItems: 'center',
      justifyContent: 'flexEnd',
      paddingBottom: 7,
      marginTop: black ? 0 : 10,
    };
  };

  return (
    <Box style={{ flexDirection: 'row', flexWrap: layout === 'grid' ? 'wrap' : 'nowrap', gap: layout === 'grid' ? 6 : 2, alignItems: 'flexStart' }}>
      {notes.map((note) => (
        <Pressable
          key={note}
          onMouseDown={(payload: any) => noteDown(note, payload)}
          onMouseUp={() => noteUp(note)}
          onMouseLeave={() => noteUp(note)}
          style={keyStyle(note)}
        >
          <Text fontSize={7} color={isBlackKey(note) ? '#f8fafc' : '#111827'}>{noteName(note)}</Text>
        </Pressable>
      ))}
    </Box>
  );
}

export function Pads({
  target,
  sounds,
  rows = 2,
  cols = 4,
  velocity = true,
  mode = 'trigger',
  onTrigger,
}: {
  target: string | number;
  sounds: readonly number[];
  rows?: number;
  cols?: number;
  velocity?: boolean;
  mode?: PadMode;
  onTrigger?: (sound: number, velocity: number, event?: ControlEvent) => void;
}) {
  const audio = useAudio();
  const [latched, setLatched] = React.useState<Record<number, boolean>>({});
  const activeRef = React.useRef<Record<number, boolean>>({});
  const latchedRef = React.useRef<Record<number, boolean>>({});
  const total = Math.max(1, rows * cols);

  React.useEffect(() => { latchedRef.current = latched; }, [latched]);

  React.useEffect(() => () => {
    if (typeof target !== 'string') return;
    for (let i = 0; i < total; i++) {
      if (latchedRef.current[i]) audio.noteOff(target, 36 + i);
    }
  }, [target, total]);

  const padDown = (index: number, payload?: any): void => {
    const sound = sounds[index];
    if (typeof sound !== 'number') return;
    const v = velocity ? clamp(Number(payload?.pressure ?? 1) || 1, 0, 1) : 1;
    const ev = controlEvent();
    onTrigger?.(sound, v, ev);
    if (ev.defaultPrevented) return;

    if (typeof target === 'number') {
      audio.insertMedia(sound, target, audio.getPlayhead());
      return;
    }

    const note = 36 + index;
    if (mode === 'toggle') {
      if (latched[index]) {
        audio.noteOff(target, note);
        setLatched((prev) => ({ ...prev, [index]: false }));
      } else {
        audio.noteOn(target, note, v);
        setLatched((prev) => ({ ...prev, [index]: true }));
      }
      return;
    }

    if (activeRef.current[index]) return;
    activeRef.current[index] = true;
    audio.noteOn(target, note, v);
  };

  const padUp = (index: number): void => {
    if (typeof target !== 'string' || mode === 'toggle') return;
    if (!activeRef.current[index]) return;
    activeRef.current[index] = false;
    audio.noteOff(target, 36 + index);
  };

  return (
    <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {Array.from({ length: total }, (_, index) => {
        const disabled = typeof sounds[index] !== 'number';
        const active = !!latched[index];
        return (
          <Pressable
            key={index}
            onMouseDown={(payload: any) => padDown(index, payload)}
            onMouseUp={() => padUp(index)}
            onMouseLeave={() => padUp(index)}
            style={{
              width: 64,
              height: 56,
              borderRadius: 8,
              backgroundColor: disabled ? '#30343b' : active ? '#f2b03b' : '#334155',
              borderWidth: 1,
              borderColor: disabled ? '#414852' : active ? '#fde68a' : '#64748b',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text fontSize={9} color={disabled ? '#737b86' : active ? '#111827' : '#f8fafc'}>{disabled ? '-' : `pad ${index + 1}`}</Text>
          </Pressable>
        );
      })}
    </Box>
  );
}

export function Slider({
  target,
  param,
  property = 'param',
  min = 0,
  max = 1,
  defaultValue,
  step = 0.01,
  orientation = 'vertical',
  onChange,
}: {
  target: string | number | 'master';
  param?: string;
  property?: SliderProperty;
  min?: number;
  max?: number;
  defaultValue?: number;
  step?: number;
  orientation?: SliderOrientation;
  onChange?: (value: number) => void;
}) {
  const audio = useAudio();
  const [trackRect, setTrackRect] = React.useState<any>(null);
  const draggingRef = React.useRef(false);
  const initial = React.useMemo(() => {
    if (typeof defaultValue === 'number') return defaultValue;
    if (property === 'param' && param && target !== 'master') return audio.getParam(target, param);
    return property === 'pan' ? 0 : min;
  }, []);
  const [value, setValue] = React.useState(clamp(initial, min, max));

  const emit = (next: number): void => {
    const v = clamp(quantize(next, step), min, max);
    setValue(v);
    onChange?.(v);
    if (property === 'volume' && target === 'master') audio.setMasterVolume(v);
    else if (property === 'volume' && typeof target === 'number') audio.setTrackVolume(target, v);
    else if (property === 'pan' && typeof target === 'number') audio.setTrackPan(target, v);
    else if (property === 'param' && param && target !== 'master') audio.setModuleParam(target, param, v);
  };

  const emitPointer = (payload: any): void => {
    const next = valueFromPointer(payload, trackRect, min, max, orientation);
    if (next != null) emit(next);
  };

  const pct = max === min ? 0 : (value - min) / (max - min);
  const horizontal = orientation === 'horizontal';

  return (
    <Box style={{ gap: 6, alignItems: 'center', minWidth: horizontal ? 150 : 54 }}>
      <Text fontSize={8} color="#cbd5e1">{param ?? property}</Text>
      <Box style={{
        width: horizontal ? 132 : 44,
        height: horizontal ? 26 : orientation === 'rotary' ? 54 : 132,
        borderRadius: orientation === 'rotary' ? 27 : 7,
        backgroundColor: '#111827',
        borderWidth: 1,
        borderColor: '#334155',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 5,
      }}
        onLayout={setTrackRect}
        onMouseDown={(payload: any) => { draggingRef.current = true; emitPointer(payload); }}
        onMouseMove={(payload: any) => { if (draggingRef.current) emitPointer(payload); }}
        onMouseUp={() => { draggingRef.current = false; }}
        onMouseLeave={() => { draggingRef.current = false; }}
      >
        <Box style={{
          width: horizontal ? Math.max(6, pct * 118) : orientation === 'rotary' ? 8 : 22,
          height: horizontal ? 12 : orientation === 'rotary' ? Math.max(8, pct * 32) : Math.max(8, pct * 116),
          borderRadius: 5,
          backgroundColor: '#f2b03b',
        }} />
      </Box>
      <Text fontSize={8} color="#e5e7eb">{value.toFixed(2)}</Text>
      <Box style={{ flexDirection: 'row', gap: 5 }}>
        <SmallButton label="-" onPress={() => emit(value - step)} />
        <SmallButton label="+" onPress={() => emit(value + step)} />
      </Box>
    </Box>
  );
}

export function XYPad({
  target,
  xParam,
  yParam,
  xRange = [0, 1],
  yRange = [0, 1],
  defaultValue,
  onChange,
}: {
  target: string;
  xParam: string;
  yParam?: string;
  xRange?: [number, number];
  yRange?: [number, number];
  defaultValue?: { x: number; y: number };
  onChange?: (x: number, y: number) => void;
}) {
  const audio = useAudio();
  const [point, setPoint] = React.useState(defaultValue ?? { x: xRange[0], y: yRange[0] });
  const [padRect, setPadRect] = React.useState<any>(null);
  const draggingRef = React.useRef(false);
  const xs = [0, 0.25, 0.5, 0.75, 1];
  const ys = [1, 0.75, 0.5, 0.25, 0];

  const setAxis = (xp: number, yp: number): void => {
    const x = xRange[0] + (xRange[1] - xRange[0]) * xp;
    const y = yRange[0] + (yRange[1] - yRange[0]) * yp;
    setPoint({ x, y });
    onChange?.(x, y);
    audio.setModuleParam(target, xParam, x);
    if (yParam) audio.setModuleParam(target, yParam, y);
  };

  const setFromPointer = (payload: any): void => {
    if (!padRect || typeof payload?.x !== 'number' || typeof payload?.y !== 'number') return;
    const xp = clamp((payload.x - padRect.x) / Math.max(1, padRect.width), 0, 1);
    const yp = clamp(1 - ((payload.y - padRect.y) / Math.max(1, padRect.height)), 0, 1);
    setAxis(xp, yp);
  };

  return (
    <Box style={{ gap: 6 }}>
      <Box
        onLayout={setPadRect}
        onMouseDown={(payload: any) => { draggingRef.current = true; setFromPointer(payload); }}
        onMouseMove={(payload: any) => { if (draggingRef.current) setFromPointer(payload); }}
        onMouseUp={() => { draggingRef.current = false; }}
        onMouseLeave={() => { draggingRef.current = false; }}
        style={{ width: 178, flexDirection: 'row', flexWrap: 'wrap', gap: 4, backgroundColor: '#111827', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#334155' }}
      >
        {ys.map((yp) => xs.map((xp) => {
          const active = Math.abs(point.x - (xRange[0] + (xRange[1] - xRange[0]) * xp)) < 0.001
            && Math.abs(point.y - (yRange[0] + (yRange[1] - yRange[0]) * yp)) < 0.001;
          return (
            <Pressable key={`${xp}:${yp}`} onPress={() => setAxis(xp, yp)} style={{ width: 28, height: 28, borderRadius: 5, backgroundColor: active ? '#f2b03b' : '#243244', borderWidth: 1, borderColor: '#475569' }} />
          );
        }))}
      </Box>
      <Text fontSize={8} color="#cbd5e1">{`${xParam} ${point.x.toFixed(2)}${yParam ? ` / ${yParam} ${point.y.toFixed(2)}` : ''}`}</Text>
    </Box>
  );
}

export function StepGrid({
  track,
  sounds,
  steps = 16,
  start = 1,
  defaultPattern,
  editable = true,
  showVelocity = false,
  showProbability = false,
}: {
  track: number;
  sounds: AudioSound | readonly number[];
  steps?: number;
  start?: number;
  defaultPattern?: string;
  editable?: boolean;
  showVelocity?: boolean;
  showProbability?: boolean;
}) {
  const audio = useAudio();
  const [pattern, setPattern] = React.useState(defaultPattern ?? Array.from({ length: steps }, () => '-').join(''));
  const [velocity, setVelocity] = React.useState<Record<number, number>>({});
  const [probability, setProbability] = React.useState<Record<number, number>>({});

  React.useEffect(() => {
    audio.makePattern(sounds, track, start, normalizeHostPattern(pattern, sounds), steps);
  }, [track, start, steps, pattern, sounds]);

  const toggle = (index: number): void => {
    if (!editable) return;
    const chars = pattern.padEnd(steps, '-').slice(0, steps).split('');
    const multi = Array.isArray(sounds) && sounds.length > 1;
    chars[index] = chars[index] === '-' ? (multi ? STEP_TOKENS[index % Math.min(16, sounds.length)] : 'X') : '-';
    setPattern(chars.join(''));
  };

  const bumpVelocity = (index: number): void => {
    const next = velocity[index] == null || velocity[index] >= 1 ? 0.4 : clamp(velocity[index] + 0.2, 0, 1);
    setVelocity((prev) => ({ ...prev, [index]: next }));
    audio.setStepVelocity(track, index, next);
  };

  const bumpProbability = (index: number): void => {
    const next = probability[index] == null || probability[index] >= 1 ? 0.25 : clamp(probability[index] + 0.25, 0, 1);
    setProbability((prev) => ({ ...prev, [index]: next }));
    audio.setStepProbability(track, index, next);
  };

  return (
    <Box style={{ gap: 8 }}>
      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        {Array.from({ length: steps }, (_, index) => {
          const token = pattern[index] ?? '-';
          const active = token !== '-';
          return (
            <Pressable
              key={index}
              onPress={() => toggle(index)}
              style={{
                width: 36,
                height: 34,
                borderRadius: 6,
                backgroundColor: active ? '#f2b03b' : '#1f2933',
                borderWidth: 1,
                borderColor: active ? '#fde68a' : '#374151',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text fontSize={9} color={active ? '#111827' : '#cbd5e1'}>{token === '-' ? String(index + 1) : token}</Text>
            </Pressable>
          );
        })}
      </Box>
      {showVelocity && (
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {Array.from({ length: steps }, (_, index) => <SmallButton key={index} label={`v${Math.round((velocity[index] ?? 0.8) * 10)}`} onPress={() => bumpVelocity(index)} />)}
        </Box>
      )}
      {showProbability && (
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {Array.from({ length: steps }, (_, index) => <SmallButton key={index} label={`p${Math.round((probability[index] ?? 1) * 10)}`} onPress={() => bumpProbability(index)} />)}
        </Box>
      )}
    </Box>
  );
}

export function StepPattern({
  steps,
  currentStep = -1,
  color = '#f2b03b',
  inactiveColor = '#969696',
  liveColor = '#f2b03b',
  levels = 3,
  editable = true,
  onChange,
  padWidth = 68,
  padHeight = 58,
}: {
  steps: readonly PatternTrackStep[];
  currentStep?: number;
  color?: string;
  inactiveColor?: string;
  liveColor?: string;
  levels?: number;
  editable?: boolean;
  onChange?: (steps: PatternStepLevel[]) => void;
  padWidth?: number;
  padHeight?: number;
}) {
  const count = Math.max(1, steps.length);
  const toggle = (index: number): void => {
    if (!editable) return;
    const next = Array.from({ length: count }, (_, i) => {
      const value = Math.max(0, Math.min(2, Math.floor(Number(steps[i]) || 0)));
      return (i === index ? cyclePatternLevel(value, levels) : value) as PatternStepLevel;
    });
    onChange?.(next);
  };

  return (
    <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {Array.from({ length: count }, (_, step) => {
        const level = Math.max(0, Math.min(2, Math.floor(Number(steps[step]) || 0))) as PatternStepLevel;
        const live = step === currentStep;
        return (
          <Pressable
            key={step}
            onPress={() => toggle(step)}
            style={{
              width: padWidth,
              height: padHeight,
              borderRadius: 10,
              backgroundColor: level === 0 ? inactiveColor : color,
              borderWidth: live ? 3 : 1,
              borderColor: live ? liveColor : '#2d2d2d',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Text fontSize={14} color={level === 0 ? '#292929' : '#171717'}>{String(step + 1)}</Text>
            <Text fontSize={7} color={level === 0 ? '#292929' : '#171717'}>
              {level >= 2 ? 'accent' : level === 1 ? 'hit' : 'rest'}
            </Text>
          </Pressable>
        );
      })}
    </Box>
  );
}

export function StepMeter({
  steps,
  currentStep = -1,
  color = '#f2b03b',
  accentColor = '#f2b03b',
  liveColor = '#111111',
  inactiveColor = '#8c8a7f',
}: {
  steps: readonly PatternTrackStep[];
  currentStep?: number;
  color?: string;
  accentColor?: string;
  liveColor?: string;
  inactiveColor?: string;
}) {
  return (
    <Box style={{ flexDirection: 'row', gap: 3 }}>
      {steps.map((raw, step) => {
        const level = Math.max(0, Math.min(2, Math.floor(Number(raw) || 0)));
        const isLit = level > 0;
        const live = step === currentStep;
        return (
          <Box
            key={step}
            style={{
              width: 14,
              height: 22,
              borderRadius: 3,
              backgroundColor: live ? liveColor : isLit ? color : inactiveColor,
              borderWidth: 1,
              borderColor: level >= 2 ? accentColor : '#5d5b52',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text fontSize={7} color={live ? '#f0dd9a' : isLit ? '#171717' : '#2f2f2f'}>{String((step + 1) % 10)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function LevelMeter({
  value,
  segments = 10,
  color = '#f2b03b',
  inactiveColor = '#334155',
  label,
  width = 17,
  height = 10,
}: {
  value: number;
  segments?: number;
  color?: string;
  inactiveColor?: string;
  label?: string;
  width?: number;
  height?: number;
}) {
  const count = Math.max(1, Math.floor(segments || 10));
  const v = clamp(Number(value) || 0, 0, 1);
  return (
    <Box style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
      {label ? <Text fontSize={8} color="#222222">{label}</Text> : null}
      {Array.from({ length: count }, (_, segment) => (
        <Box
          key={segment}
          style={{
            width,
            height,
            borderRadius: 2,
            backgroundColor: v > (segment + 1) / count ? color : inactiveColor,
          }}
        />
      ))}
    </Box>
  );
}

export function Knob({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  color = '#f2b03b',
  onChange,
  formatValue,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  color?: string;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}) {
  const v = clamp(Number(value) || 0, min, max);
  const emit = (delta: number): void => onChange(clamp(quantize(v + delta, step), min, max));
  return (
    <Box style={{ flexGrow: 1, gap: 5, alignItems: 'center' }}>
      <Text fontSize={8} color="#d7a742">{label}</Text>
      <Box style={{ width: 78, height: 78, borderRadius: 39, backgroundColor: '#9f9f9f', borderWidth: 3, borderColor: '#333333', justifyContent: 'center', alignItems: 'center' }}>
        <Box style={{ width: 12, height: 28, borderRadius: 6, backgroundColor: color, marginBottom: 4 }} />
        <Text fontSize={9} color="#111111">{formatValue ? formatValue(v) : v.toFixed(2)}</Text>
      </Box>
      <Box style={{ flexDirection: 'row', gap: 6 }}>
        <Pressable onPress={() => emit(-step)} style={{ width: 28, height: 20, borderRadius: 10, backgroundColor: '#2e2e2e', alignItems: 'center', justifyContent: 'center' }}>
          <Text fontSize={10} color="#f6f1e6">-</Text>
        </Pressable>
        <Pressable onPress={() => emit(step)} style={{ width: 28, height: 20, borderRadius: 10, backgroundColor: '#2e2e2e', alignItems: 'center', justifyContent: 'center' }}>
          <Text fontSize={10} color="#f6f1e6">+</Text>
        </Pressable>
      </Box>
    </Box>
  );
}

export function TrackSelector<T>({
  tracks,
  selected,
  onSelect,
  getId,
  getLabel,
  getColor,
  getSubtitle,
}: {
  tracks: readonly T[];
  selected: number;
  onSelect: (index: number) => void;
  getId?: (track: T, index: number) => string;
  getLabel: (track: T, index: number) => string;
  getColor: (track: T, index: number) => string;
  getSubtitle?: (track: T, index: number) => string;
}) {
  return (
    <Box style={{ flexDirection: 'row', gap: 6 }}>
      {tracks.map((track, index) => {
        const active = index === selected;
        const color = getColor(track, index);
        return (
          <Pressable
            key={getId ? getId(track, index) : String(index)}
            onPress={() => onSelect(index)}
            style={{
              flexGrow: 1,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: active ? '#f2b03b' : '#363636',
              backgroundColor: active ? color : '#1a1a1a',
              paddingTop: 7,
              paddingBottom: 7,
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Text fontSize={8} color={active ? '#171717' : '#b0b0b0'}>{getLabel(track, index)}</Text>
            {getSubtitle ? <Text fontSize={10} color={active ? '#171717' : '#f4efe3'}>{getSubtitle(track, index)}</Text> : null}
          </Pressable>
        );
      })}
    </Box>
  );
}

export function PatternTrack({
  track,
  sound,
  steps,
  volume = 1,
  pan = 0,
  probability = 1,
  offset = 0,
  swing = 0,
  start = 1,
  stepsPerMeasure,
  enabled = true,
}: {
  track: number;
  sound: AudioSound;
  steps: readonly PatternTrackStep[];
  volume?: number;
  pan?: number;
  probability?: number;
  offset?: number;
  swing?: number;
  start?: number;
  stepsPerMeasure?: number;
  enabled?: boolean;
}) {
  const audio = useAudio();
  const stepCount = Math.max(1, stepsPerMeasure ?? steps.length);
  const pattern = patternStringFromSteps(steps);
  const levelsKey = steps.map((step) => String(Math.max(0, Math.min(2, Math.floor(Number(step) || 0))))).join(',');

  React.useEffect(() => {
    if (!enabled) return;
    audio.clearTrack(track);
    audio.makePattern(sound, track, start, pattern, stepCount);
    audio.setTrackVolume(track, volume);
    audio.setTrackPan(track, pan);
    audio.setTrackMute(track, false);
    audio.setTrackSolo(track, false);

    for (let step = 0; step < steps.length; step++) {
      const level = Math.max(0, Math.min(2, Math.floor(Number(steps[step]) || 0)));
      if (level > 0) {
        audio.setStepVelocity(track, step, level >= 2 ? 1.0 : 0.66);
        audio.setStepProbability(track, step, probability);
      }
      const swung = step % 2 === 1 ? swing * 0.42 : 0;
      audio.setStepOffset(track, step, clamp(offset + swung, -0.5, 0.5));
    }

    return () => {
      audio.clearTrack(track);
    };
  }, [enabled, track, sound, start, pattern, levelsKey, stepCount, volume, pan, probability, offset, swing]);

  return null;
}

export function Transport({
  onPlay,
  onPause,
  onStop,
  showBpm = true,
  showTimeSig = true,
  showPosition = true,
  showMeter = false,
}: {
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  showBpm?: boolean;
  showTimeSig?: boolean;
  showPosition?: boolean;
  showMeter?: boolean;
}) {
  const audio = useAudio();
  const [playing, setPlaying] = React.useState(false);
  const [bpm, setBpm] = React.useState('120');
  const [timeSig, setTimeSig] = React.useState('4/4');
  const [position, setPosition] = React.useState(1);
  const [peak, setPeak] = React.useState(0);

  useInterval(() => {
    setPlaying(audio.isPlaying());
    setPosition(audio.getPlayhead());
    if (showMeter) setPeak(audio.getPeakLevel());
  }, 33);

  const commitBpm = (): void => {
    const n = Number(bpm);
    if (Number.isFinite(n) && n > 0) audio.setTempo(n, 1);
  };

  const commitTimeSig = (): void => {
    const [num, den] = timeSig.split('/').map((v) => Number(v));
    const fn = (audio as any).setTimeSignature;
    if (typeof fn === 'function' && Number.isFinite(num) && Number.isFinite(den)) fn(num, den);
  };

  return (
    <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <SmallButton label={playing ? 'pause' : 'play'} active={playing} onPress={() => {
        if (playing) { onPause?.(); audio.pause(); }
        else { onPlay?.(); audio.play(); }
      }} />
      <SmallButton label="stop" onPress={() => { onStop?.(); audio.stop(); }} />
      {showBpm && (
        <Box style={{ width: 66 }}>
          <TextInput value={bpm} onChange={setBpm} onSubmit={commitBpm} onKeyDown={(e: any) => { if (e?.key === 'Enter') commitBpm(); }} style={{ fontSize: 10, color: '#f8fafc', backgroundColor: '#111827', borderRadius: 5, padding: 6 }} />
        </Box>
      )}
      {showTimeSig && (
        <Box style={{ width: 54 }}>
          <TextInput value={timeSig} onChange={setTimeSig} onSubmit={commitTimeSig} onKeyDown={(e: any) => { if (e?.key === 'Enter') commitTimeSig(); }} style={{ fontSize: 10, color: '#f8fafc', backgroundColor: '#111827', borderRadius: 5, padding: 6 }} />
        </Box>
      )}
      {showPosition && <Text fontSize={10} color="#cbd5e1">{`m ${position.toFixed(2)}`}</Text>}
      {showMeter && (
        <Box style={{ flexDirection: 'row', gap: 3 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <Box key={i} style={{ width: 8, height: 22, borderRadius: 2, backgroundColor: peak > (i + 1) / 8 ? '#f2b03b' : '#334155' }} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export function Scope({
  source = 'master',
  mode = 'waveform',
  bufferSize = 512,
}: {
  source?: 'master' | string;
  mode?: 'waveform' | 'spectrum';
  bufferSize?: number;
}) {
  const audio = useAudio();
  const [peak, setPeak] = React.useState(0);
  const bars = Math.max(8, Math.min(32, Math.floor(bufferSize / 32)));

  useInterval(() => {
    setPeak(source === 'master' ? audio.getPeakLevel() : audio.getPeakLevel());
  }, 33);

  return (
    <Box style={{ width: 220, height: 86, backgroundColor: '#0f172a', borderRadius: 8, borderWidth: 1, borderColor: '#334155', padding: 8, gap: 5 }}>
      <Box style={{ flexDirection: 'row', gap: 3, alignItems: 'center', height: 52 }}>
        {Array.from({ length: bars }, (_, i) => {
          const phase = mode === 'spectrum' ? (i + 1) / bars : Math.abs(Math.sin((i / bars) * Math.PI * 2));
          const h = Math.max(3, peak * 46 * phase);
          return <Box key={i} style={{ width: 5, height: h, borderRadius: 2, backgroundColor: '#38bdf8' }} />;
        })}
      </Box>
      <Text fontSize={8} color="#94a3b8">{`${source} ${mode} ${peak.toFixed(2)}`}</Text>
    </Box>
  );
}

export function ModulePanel({
  id,
  excludedParams = [],
  layout = 'vertical',
  sliderOrientation,
}: {
  id: string;
  excludedParams?: string[];
  layout?: 'vertical' | 'horizontal' | 'grid';
  sliderOrientation?: SliderOrientation;
}) {
  const audio = useAudio();
  const defs = audio.getParamDefinitions(id).filter((def: AudioParamDefinition) => !excludedParams.includes(def.name));
  const horizontal = layout === 'horizontal' || layout === 'grid';
  const orientation = sliderOrientation ?? (layout === 'horizontal' ? 'horizontal' : 'vertical');

  return (
    <Box style={{ gap: 10 }}>
      <Text fontSize={10} color="#e5e7eb">{id}</Text>
      <Box style={{ flexDirection: horizontal ? 'row' : 'column', flexWrap: layout === 'grid' ? 'wrap' : 'nowrap', gap: 10 }}>
        {defs.map((def: AudioParamDefinition) => (
          <Slider
            key={def.name}
            property="param"
            target={id}
            param={def.name}
            min={def.min}
            max={def.max}
            defaultValue={def.defaultValue}
            step={(def.max - def.min) / 100}
            orientation={orientation}
          />
        ))}
      </Box>
    </Box>
  );
}

export const AudioControls = {
  Keybed,
  Pads,
  Slider,
  XYPad,
  StepGrid,
  StepPattern,
  StepMeter,
  LevelMeter,
  Knob,
  TrackSelector,
  PatternTrack,
  Transport,
  Scope,
  ModulePanel,
};

export { AUDIO_SOUND };
