import { useEffect } from 'react';
import { Audio, Box, Col, Row, Pressable, Text } from '@reactjit/runtime/primitives';
import { useAudio } from '@reactjit/runtime/hooks';

type Pad = {
  id: string;
  label: string;
  color: string;
  voice: 0 | 1 | 2 | 3 | 4;
  tone: number;
  decay: number;
  color2: number;
  drive: number;
  midi: number;
};

const PADS: Pad[] = [
  { id: 'kick',  label: 'KICK',         color: '#f2553b', voice: 0, tone: 0.15, decay: 0.38, color2: 0.20, drive: 0.25, midi: 36 },
  { id: 'snare', label: 'SNARE',        color: '#58e3dd', voice: 1, tone: 0.45, decay: 0.22, color2: 0.55, drive: 0.30, midi: 38 },
  { id: 'tom',   label: 'TOM',          color: '#f2b03b', voice: 3, tone: 0.30, decay: 0.20, color2: 0.40, drive: 0.20, midi: 45 },
  { id: 'chat',  label: 'CLOSED\nHAT',  color: '#8f70ff', voice: 2, tone: 0.55, decay: 0.07, color2: 0.60, drive: 0.18, midi: 42 },
  { id: 'ohat',  label: 'OPEN\nHAT',    color: '#7be08a', voice: 2, tone: 0.50, decay: 0.55, color2: 0.85, drive: 0.22, midi: 46 },
];

// Five toms across the kit. Voice 3 (`bass` DSP) is pitched; midi sets the
// fundamental, tone biases the formant. Decay shortens at the top so the
// high tom doesn't ring like a bass note.
const TOMS: Pad[] = [
  { id: 'tom1', label: 'FLOOR', color: '#7a3a1f', voice: 3, tone: 0.10, decay: 0.28, color2: 0.30, drive: 0.22, midi: 33 },
  { id: 'tom2', label: 'LOW',   color: '#9a5a26', voice: 3, tone: 0.25, decay: 0.24, color2: 0.35, drive: 0.22, midi: 38 },
  { id: 'tom3', label: 'MID',   color: '#c07a2e', voice: 3, tone: 0.40, decay: 0.20, color2: 0.40, drive: 0.22, midi: 43 },
  { id: 'tom4', label: 'HIGH',  color: '#e09a3a', voice: 3, tone: 0.55, decay: 0.17, color2: 0.45, drive: 0.22, midi: 48 },
  { id: 'tom5', label: 'RACK',  color: '#f8be5c', voice: 3, tone: 0.70, decay: 0.14, color2: 0.50, drive: 0.22, midi: 53 },
];

// Five kicks across the spectrum. All voice 0; sub→click sweep on tone+color,
// shrinking decay, growing drive. Midi note nudges the body frequency.
const KICKS: Pad[] = [
  { id: 'kick1', label: 'SUB',   color: '#3a2070', voice: 0, tone: 0.05, decay: 0.55, color2: 0.05, drive: 0.10, midi: 28 },
  { id: 'kick2', label: 'BOOM',  color: '#5a2880', voice: 0, tone: 0.18, decay: 0.42, color2: 0.20, drive: 0.28, midi: 33 },
  { id: 'kick3', label: 'PUNCH', color: '#82308f', voice: 0, tone: 0.32, decay: 0.32, color2: 0.45, drive: 0.42, midi: 36 },
  { id: 'kick4', label: 'CLICK', color: '#b03c8f', voice: 0, tone: 0.62, decay: 0.20, color2: 0.82, drive: 0.55, midi: 40 },
  { id: 'kick5', label: 'DIRT',  color: '#d4488a', voice: 0, tone: 0.22, decay: 0.26, color2: 0.55, drive: 0.85, midi: 35 },
];

// Humanize index — exposed in audio.zig as instrument param 6 but not in the
// runtime's param-name table. Pushing this past the 0.15 default makes
// repeated hits stop sounding identical: per-trigger LCG nudges tone, color,
// drive, decay and phase, while incoming velocity influences brightness.
const HUMANIZE_PARAM_INDEX = 6;
const HUMANIZE_AMOUNT = 0.60;

// Velocity range per hit. Even with humanize off, varying velocity per press
// re-shapes the timbre — the DSP couples velocity into freq, brightness and
// decay length.
const VEL_MIN = 0.72;
const VEL_MAX = 1.00;

function hit(audio: any, pad: Pad) {
  const velocity = VEL_MIN + Math.random() * (VEL_MAX - VEL_MIN);
  audio.noteOn(pad.id, pad.midi, velocity);
}

function DrumPad({ pad, size = 132 }: { pad: Pad; size?: number }) {
  const audio = useAudio();
  return (
    <Pressable
      onPress={() => hit(audio, pad)}
      style={{
        width: size,
        height: size,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: pad.color,
        backgroundColor: '#161b24',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <Box style={{ width: size * 0.27, height: size * 0.27, borderRadius: size * 0.135, backgroundColor: pad.color }} />
      <Text fontSize={11} color={pad.color} style={{ textAlign: 'center' }}>{pad.label}</Text>
    </Pressable>
  );
}

export default function Drums5() {
  const audio = useAudio();

  useEffect(() => {
    audio.initAudio() || audio.isAudioInitialized();
    audio.setMasterVolume(0.6);
    return () => { audio.deinitAudio(); };
  }, []);

  const ALL = [...PADS, ...TOMS, ...KICKS];

  // Humanize every instrument once they've registered. Runs after the modules'
  // own mount effects so the host has the numeric id.
  useEffect(() => {
    const t = setTimeout(() => {
      for (const p of ALL) audio.setParamIndex(p.id, HUMANIZE_PARAM_INDEX, HUMANIZE_AMOUNT);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <Audio gain={0.7}>
      {ALL.map(p => (
        <Audio.Module
          key={p.id}
          id={p.id}
          type="instrument"
          voice={p.voice}
          tone={p.tone}
          decay={p.decay}
          color={p.color2}
          drive={p.drive}
          gain={0.9}
        />
      ))}

      <Col style={{ width: '100%', height: '100%', backgroundColor: '#0c1018', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <Col style={{ gap: 8, alignItems: 'center' }}>
          <Text fontSize={11} color="#7a8494">KIT</Text>
          <Row style={{ gap: 14 }}>
            {PADS.map(p => <DrumPad key={p.id} pad={p} />)}
          </Row>
        </Col>

        <Box style={{ width: 720, height: 1, backgroundColor: '#1d2430' }} />

        <Col style={{ gap: 8, alignItems: 'center' }}>
          <Text fontSize={11} color="#7a8494">TOMS — floor → rack</Text>
          <Row style={{ gap: 12 }}>
            {TOMS.map(p => <DrumPad key={p.id} pad={p} size={112} />)}
          </Row>
        </Col>

        <Box style={{ width: 720, height: 1, backgroundColor: '#1d2430' }} />

        <Col style={{ gap: 8, alignItems: 'center' }}>
          <Text fontSize={11} color="#7a8494">KICKS — sub → click → dirt</Text>
          <Row style={{ gap: 12 }}>
            {KICKS.map(p => <DrumPad key={p.id} pad={p} size={112} />)}
          </Row>
        </Col>
      </Col>
    </Audio>
  );
}
