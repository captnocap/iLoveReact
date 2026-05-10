// DAW — Digital Audio Workstation
//
// Built on gallery atoms + runtime audio. Self-contained controls call the
// engine directly — no lifted drag state, so the page doesn't re-render on
// every slider tick.

import { useState, useCallback, useEffect } from 'react';
import { Box, Col, Row, Pressable } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { Audio, useAudio, AUDIO_SOUND } from '@reactjit/runtime/audio';
import { AudioControls } from '@reactjit/runtime/audio-controls';
import { BipolarSlider } from '../gallery/components/controls-specimen/BipolarSlider';
import { RotaryKnob } from '../gallery/components/controls-specimen/RotaryKnob';
import { VerticalMeterStrip } from '../gallery/components/controls-specimen/VerticalMeterStrip';
import {
  Mono,
  Body,
  SparkBars,
} from '../gallery/components/controls-specimen/controlsSpecimenParts';
import { CTRL } from '../gallery/components/controls-specimen/controlsSpecimenTheme';
import { useControllableNumberState, useVerticalPercentDrag } from '../gallery/components/controls-specimen/controlsSpecimenInteractions';
import {
  KeyboardMusic, CirclePlay, CirclePause, CircleStop, Disc2,
} from '@reactjit/runtime/icons/icons';
import { useMIDI } from '@reactjit/runtime/hooks/useMIDI';
import { useHudInsets } from '../shell';

// ── Types ────────────────────────────────────────────────────────────

type TrackTone = 'accent' | 'ok' | 'warn' | 'flag' | 'blue' | 'lilac';

type TrackConfig = {
  id: number;
  label: string;
  sound: number;
  tone: TrackTone;
  steps: (0 | 1 | 2)[];
};

// ── Constants ────────────────────────────────────────────────────────

const STEP_COUNT = 16;
const TRACKS: TrackConfig[] = [
  { id: 1, label: 'KICK',  sound: AUDIO_SOUND.kick,  tone: 'accent', steps: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0] },
  { id: 2, label: 'SNARE', sound: AUDIO_SOUND.snare, tone: 'ok',     steps: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0] },
  { id: 3, label: 'HAT',   sound: AUDIO_SOUND.hat,   tone: 'warn',   steps: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1] },
  { id: 4, label: 'BASS',  sound: AUDIO_SOUND.bass,  tone: 'blue',   steps: [1,0,0,1,0,0,1,0,0,0,1,0,0,1,0,0] },
];

const DEFAULT_BPM = 120;

// ── Compact channel fader (no AtomFrame wrapper) ─────────────────────

function CompactFader({
  label,
  onChange,
}: {
  label: string;
  onChange?: (next: number) => void;
}) {
  // No `value` here — passing it would lock the hook into controlled mode and
  // freeze the fader at the prop value (the same bug RotaryKnob/BipolarSlider had).
  const [value, setValue] = useControllableNumberState({ defaultValue: 72, onChange });
  const trackHeight = 110;
  const drag = useVerticalPercentDrag(value, setValue, trackHeight);
  const fillHeight = Math.round(drag.ratio * trackHeight);

  return (
    <Box style={{ alignItems: 'center', gap: 4 }}>
      <Box style={{ width: 22, height: trackHeight + 10, position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
        <Box style={{ width: 14, height: trackHeight, borderWidth: 1, borderColor: CTRL.ruleBright, backgroundColor: CTRL.bg1 }} />
        <Box
          style={{
            position: 'absolute',
            left: 5,
            bottom: 5,
            width: 10,
            height: fillHeight,
            backgroundColor: CTRL.accent,
          }}
        />
        <Box
          style={{
            position: 'absolute',
            left: 2,
            bottom: 5 + fillHeight - 4,
            width: 18,
            height: 8,
            borderWidth: 1,
            borderColor: CTRL.accent,
            backgroundColor: drag.dragging ? CTRL.accentHot : CTRL.bg3,
          }}
        />
        <Pressable
          onMouseDown={drag.begin}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
        />
      </Box>
      <Mono fontSize={8} color={CTRL.inkDim}>{label}</Mono>
    </Box>
  );
}

// ── Chrome atoms ─────────────────────────────────────────────────────

function TransportBtn({ icon, onPress, active, color }: { icon: number[][]; onPress: () => void; active?: boolean; color?: string }) {
  return (
    <Pressable onPress={onPress}>
      <Box
        style={{
          width: 34,
          height: 34,
          borderRadius: 6,
          backgroundColor: active ? (color || CTRL.accent) : CTRL.bg2,
          borderWidth: 1,
          borderColor: active ? (color || CTRL.accentHot) : CTRL.ruleBright,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <S.AppNavIcon icon={icon} />
      </Box>
    </Pressable>
  );
}

function MuteSoloPill({ label, active, tone, onPress }: { label: string; active: boolean; tone: 'flag' | 'accent'; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexGrow: 1 }}>
      <Box
        style={{
          paddingTop: 3,
          paddingBottom: 3,
          alignItems: 'center',
          borderWidth: 1,
          borderColor: active ? CTRL[tone] : CTRL.rule,
          backgroundColor: active ? CTRL[tone] : CTRL.bg1,
        }}
      >
        <Mono color={active ? CTRL.bg : CTRL.inkDim} fontSize={8} fontWeight="bold">
          {label}
        </Mono>
      </Box>
    </Pressable>
  );
}

function StepPad({
  step,
  isCurrent,
  tone,
  onPress,
}: {
  step: 0 | 1 | 2;
  isCurrent: boolean;
  tone: TrackTone;
  onPress: () => void;
}) {
  const active = step > 0;
  const accented = step >= 2;
  return (
    <Pressable onPress={onPress}>
      <Box
        style={{
          width: 40,
          height: 34,
          borderWidth: isCurrent ? 2 : 1,
          borderColor: isCurrent ? CTRL.ink : active ? (accented ? CTRL.accentHot : CTRL[tone]) : CTRL.rule,
          backgroundColor: active ? CTRL[tone] : CTRL.bg1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {accented && (
          <Box style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: CTRL.bg }} />
        )}
      </Box>
    </Pressable>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function DAWPage() {
  const audio = useAudio();
  const insets = useHudInsets();
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [tracks, setTracks] = useState(TRACKS);
  const [mutes, setMutes] = useState<boolean[]>([false, false, false, false]);
  const [solos, setSolos] = useState<boolean[]>([false, false, false, false]);
  const [position, setPosition] = useState(0);
  const [peak, setPeak] = useState(0);

  useEffect(() => {
    audio.initAudio();
    audio.setMasterVolume(0.7);
    return () => { audio.deinitAudio(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { audio.setTempo(bpm, 1); }, [bpm, audio]);

  useEffect(() => {
    for (let i = 0; i < 4; i++) {
      audio.setTrackMute(i + 1, mutes[i]);
      audio.setTrackSolo(i + 1, solos[i]);
    }
  }, [mutes, solos, audio]);

  useEffect(() => {
    const id = setInterval(() => {
      setPlaying(audio.isPlaying());
      setPosition(audio.getPlayhead());
      setPeak(audio.getPeakLevel());
    }, 50);
    return () => clearInterval(id);
  }, [audio]);

  const togglePlay = useCallback(() => {
    audio.isPlaying() ? audio.pause() : audio.play();
  }, [audio]);

  const stop = useCallback(() => { audio.stop(); setRecording(false); }, [audio]);

  const cycleStep = useCallback((trackIndex: number, stepIndex: number) => {
    setTracks((prev) => {
      const copy = prev.map((t) => ({ ...t, steps: [...t.steps] }));
      const current = copy[trackIndex].steps[stepIndex];
      copy[trackIndex].steps[stepIndex] = (current + 1) % 3 as 0 | 1 | 2;
      return copy;
    });
  }, []);

  useMIDI({ autoStart: true, target: 'inst1' });

  const currentStep = playing ? Math.floor((position % 1) * STEP_COUNT) : -1;
  const sparkValues = Array.from({ length: 8 }, (_, i) =>
    Math.max(0.05, peak * (1 - i * 0.08) + Math.random() * 0.08)
  );

  const trackMeters = tracks.map((_, i) => {
    const base = Math.sin(position * 4 + i * 1.5) * 0.3 + 0.3;
    return Math.max(0, Math.min(100, (base + peak * 0.4) * 100));
  });

  return (
    <Audio gain={0.7}>
      <Audio.Module id="inst1" type="instrument" voice={0} tone={0.5} decay={0.35} color={0.5} drive={0.2} gain={0.8} />
      <Audio.Module id="env1" type="envelope" attack={0.01} decay={0.2} sustain={0.5} release={0.3} />
      <Audio.Module id="filt1" type="filter" cutoff={1800} resonance={0.15} mode={0} />
      <Audio.Module id="lfo1" type="lfo" rate={1.5} depth={0.2} waveform={0} />
      <Audio.Connection from="inst1" to="filt1" />
      <Audio.Connection from="filt1" to="master" />

      <Col
        style={{
          flexGrow: 1,
          backgroundColor: 'theme:bg',
          paddingBottom: insets.bottom,
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 10,
          gap: 10,
        }}
      >
        {/* ── Transport ─────────────────────────────────────────── */}
        <S.InlineX5Between>
          <S.InlineX3>
            <TransportBtn icon={playing ? CirclePause : CirclePlay} onPress={togglePlay} active={playing} />
            <TransportBtn icon={CircleStop} onPress={stop} />
            <TransportBtn icon={Disc2} onPress={() => setRecording((r) => !r)} active={recording} color={CTRL.flag} />
            <Box
              style={{
                width: 68,
                padding: 6,
                borderWidth: 1,
                borderColor: CTRL.ruleBright,
                backgroundColor: CTRL.bg2,
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Mono color={CTRL.inkDimmer} fontSize={8}>BPM</Mono>
              <Body fontSize={14} bold>{bpm}</Body>
            </Box>
          </S.InlineX3>

          <SparkBars values={sparkValues} height={24} stretch tone="accent" />

          <S.InlineX3>
            <Mono color={CTRL.inkDim}>{`m ${position.toFixed(2)}`}</Mono>
            <Mono color={CTRL.inkGhost}>{playing ? 'RUNNING' : 'STOPPED'}</Mono>
          </S.InlineX3>
        </S.InlineX5Between>

        {/* ── Workspace ─────────────────────────────────────────── */}
        <Row style={{ flexGrow: 1, gap: 10, minHeight: 0 }}>
          {/* Mixer strips */}
          <Row style={{ gap: 6, flexShrink: 0 }}>
            {TRACKS.map((track, i) => (
              <Col
                key={track.id}
                style={{
                  width: 84,
                  gap: 6,
                  padding: 8,
                  borderWidth: 1,
                  borderColor: CTRL.ruleBright,
                  backgroundColor: CTRL.bg2,
                  alignItems: 'center',
                }}
              >
                <Mono color={CTRL[track.tone]} fontSize={9} fontWeight="bold">
                  {track.label}
                </Mono>

                <RotaryKnob
                  size={32}
                  label="DRV"
                  onChange={(v) => audio.setModuleParam('inst1', 'drive', v / 100)}
                />

                <Row style={{ gap: 4, alignItems: 'flex-end' }}>
                  <CompactFader
                    label="VOL"
                    onChange={(v) => audio.setTrackVolume(track.id, v / 100)}
                  />
                  <VerticalMeterStrip value={trackMeters[i]} segments={18} width={6} />
                </Row>

                <Box style={{ width: 68 }}>
                  <BipolarSlider
                    label="PAN"
                    width={68}
                    onChange={(v) => audio.setTrackPan(track.id, (v - 50) / 50)}
                  />
                </Box>

                <Row style={{ width: '100%', gap: 2 }}>
                  <MuteSoloPill
                    label="M"
                    active={mutes[i]}
                    tone="flag"
                    onPress={() => setMutes((p) => { const n = [...p]; n[i] = !n[i]; return n; })}
                  />
                  <MuteSoloPill
                    label="S"
                    active={solos[i]}
                    tone="accent"
                    onPress={() => setSolos((p) => { const n = [...p]; n[i] = !n[i]; return n; })}
                  />
                </Row>
              </Col>
            ))}
          </Row>

          {/* Right column */}
          <Col style={{ flexGrow: 1, gap: 10, minWidth: 0 }}>
            {/* Sequencer */}
            <Box
              style={{
                borderWidth: 1,
                borderColor: CTRL.ruleBright,
                backgroundColor: CTRL.bg2,
                padding: 10,
                gap: 8,
              }}
            >
              <S.InlineX3>
                <Mono color={CTRL.accent} fontSize={9} fontWeight="bold">STEP SEQUENCER</Mono>
                <Mono color={CTRL.inkGhost} fontSize={8}>{`16 STEPS · 4/4 · ${recording ? 'REC' : playing ? 'PLAY' : 'STOP'}`}</Mono>
              </S.InlineX3>

              <Col style={{ gap: 6 }}>
                {tracks.map((track, i) => (
                  <Row key={track.id} style={{ gap: 8, alignItems: 'center' }}>
                    <Box style={{ width: 48, alignItems: 'flex-end' }}>
                      <Mono color={CTRL[track.tone]} fontSize={9} fontWeight="bold">
                        {track.label}
                      </Mono>
                    </Box>
                    <Row style={{ gap: 3, flexWrap: 'wrap' }}>
                      {track.steps.map((step, j) => (
                        <Box key={j} style={{ marginRight: j % 4 === 3 ? 8 : 0 }}>
                          <StepPad
                            step={step}
                            isCurrent={currentStep === j}
                            tone={track.tone}
                            onPress={() => cycleStep(i, j)}
                          />
                        </Box>
                      ))}
                    </Row>
                  </Row>
                ))}
              </Col>

              {/* Step numbers */}
              <Row style={{ gap: 3, paddingLeft: 56 }}>
                {Array.from({ length: STEP_COUNT }).map((_, j) => (
                  <Box key={j} style={{ width: 40, alignItems: 'center', marginRight: j % 4 === 3 ? 8 : 0 }}>
                    <Mono fontSize={7} color={j % 4 === 0 ? CTRL.inkDim : CTRL.inkGhost}>
                      {String(j + 1).padStart(2, '0')}
                    </Mono>
                  </Box>
                ))}
              </Row>

              {TRACKS.map((track, i) => (
                <AudioControls.PatternTrack
                  key={track.id}
                  track={track.id}
                  sound={track.sound}
                  steps={track.steps}
                  enabled={!mutes[i]}
                  start={1}
                  stepsPerMeasure={STEP_COUNT}
                />
              ))}
            </Box>

            {/* Synth params */}
            <Box
              style={{
                borderWidth: 1,
                borderColor: CTRL.ruleBright,
                backgroundColor: CTRL.bg2,
                padding: 10,
                gap: 8,
              }}
            >
              <S.InlineX3>
                <Mono color={CTRL.accent} fontSize={9} fontWeight="bold">SYNTH · INST.01</Mono>
              </S.InlineX3>
              <Row style={{ gap: 14, flexWrap: 'wrap' }}>
                <RotaryKnob label="TONE" onChange={(v) => audio.setModuleParam('inst1', 'tone', v / 100)} />
                <RotaryKnob label="DECAY" onChange={(v) => audio.setModuleParam('inst1', 'decay', v / 100)} />
                <RotaryKnob label="COLOR" onChange={(v) => audio.setModuleParam('inst1', 'color', v / 100)} />
                <RotaryKnob label="DRIVE" onChange={(v) => audio.setModuleParam('inst1', 'drive', v / 100)} />
                <RotaryKnob label="CUTOFF" onChange={(v) => audio.setModuleParam('filt1', 'cutoff', 100 + v * 39)} />
                <RotaryKnob label="RESO" onChange={(v) => audio.setModuleParam('filt1', 'resonance', v / 100)} />
              </Row>
            </Box>

            {/* Keybed */}
            <Col
              style={{
                flexGrow: 1,
                borderWidth: 1,
                borderColor: CTRL.ruleBright,
                backgroundColor: CTRL.bg1,
                padding: 10,
                gap: 8,
                justifyContent: 'flex-end',
              }}
            >
              <S.InlineX3>
                <S.AppNavIcon icon={KeyboardMusic} />
                <Mono color={CTRL.accent} fontSize={9} fontWeight="bold">KEYBED</Mono>
                <Mono color={CTRL.inkGhost} fontSize={8}>C3–C5 · VELOCITY</Mono>
              </S.InlineX3>
              <AudioControls.Keybed target="inst1" range={[48, 73]} layout="piano" velocity />
            </Col>
          </Col>
        </Row>
      </Col>
    </Audio>
  );
}
