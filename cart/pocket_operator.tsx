import { useEffect, useState } from 'react';
import { AudioControls, Box, Text, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { AUDIO_SOUND, useAudio } from '@reactjit/runtime/hooks';

type StepLevel = 0 | 1 | 2;
type TrackParams = {
  volume: number;
  pan: number;
  probability: number;
  nudge: number;
};
type Track = {
  id: string;
  label: string;
  color: string;
  sound: number;
  steps: StepLevel[];
  params: TrackParams;
};

const GRID = Array.from({ length: 16 }, (_, i) => i);

const SOUND_PRESETS = [
  { label: 'kick', sound: AUDIO_SOUND.kick, params: { volume: 0.95, pan: -0.08, probability: 1.0, nudge: 0.0 } },
  { label: 'snare', sound: AUDIO_SOUND.snare, params: { volume: 0.82, pan: 0.08, probability: 1.0, nudge: 0.0 } },
  { label: 'hat', sound: AUDIO_SOUND.hat, params: { volume: 0.68, pan: 0.18, probability: 0.96, nudge: 0.0 } },
  { label: 'bass', sound: AUDIO_SOUND.bass, params: { volume: 0.84, pan: -0.04, probability: 1.0, nudge: 0.0 } },
  { label: 'lead', sound: AUDIO_SOUND.lead, params: { volume: 0.74, pan: 0.14, probability: 0.92, nudge: 0.0 } },
];

const DEFAULT_PATTERNS: StepLevel[][] = [
  [2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 1, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 1],
  [1, 0, 1, 0, 1, 2, 1, 0, 1, 0, 1, 0, 1, 2, 1, 0],
  [2, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 1, 0, 1, 2, 0],
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function soundLabel(sound: number): string {
  return SOUND_PRESETS.find((preset) => preset.sound === sound)?.label ?? 'sound';
}

function createTrack(label: string, color: string, presetIndex: number, steps: StepLevel[]): Track {
  const preset = SOUND_PRESETS[presetIndex % SOUND_PRESETS.length];
  return {
    id: label.toLowerCase(),
    label,
    color,
    sound: preset.sound,
    steps: steps.slice() as StepLevel[],
    params: { ...preset.params },
  };
}

function swapSound(track: Track, nextSound: number): Track {
  const preset = SOUND_PRESETS.find((item) => item.sound === nextSound) ?? SOUND_PRESETS[0];
  return {
    ...track,
    sound: preset.sound,
    params: {
      ...track.params,
      volume: preset.params.volume,
      pan: preset.params.pan,
      probability: preset.params.probability,
    },
  };
}

function SmallButton({ label, onPress, accent, active }: { label: string; onPress: () => void; accent: string; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexGrow: 1,
        borderRadius: 8,
        backgroundColor: active ? accent : '#212121',
        borderWidth: 1,
        borderColor: active ? '#f7d98c' : '#4b4b4b',
        paddingTop: 7,
        paddingBottom: 7,
        alignItems: 'center',
      }}
    >
      <Text fontSize={8} color={active ? '#161616' : '#f5efe4'}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const audio = useAudio();
  const [tracks, setTracks] = useState<Track[]>([
    createTrack('A', '#f6a81a', 0, DEFAULT_PATTERNS[0]),
    createTrack('B', '#ff744a', 1, DEFAULT_PATTERNS[1]),
    createTrack('C', '#58e3dd', 2, DEFAULT_PATTERNS[2]),
    createTrack('D', '#8f70ff', 3, DEFAULT_PATTERNS[3]),
  ]);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [bpm, setBpm] = useState(124);
  const [swing, setSwing] = useState(0.12);
  const [masterGain, setMasterGain] = useState(0.68);
  const [audioReady, setAudioReady] = useState(false);
  const [peak, setPeak] = useState(0);
  const [callbackUs, setCallbackUs] = useState(0);

  const selectedTrack = tracks[selectedTrackIndex];
  const activeCount = selectedTrack.steps.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0);
  const selectedSoundLabel = soundLabel(selectedTrack.sound);

  useEffect(() => {
    const ok = audio.initAudio() || audio.isAudioInitialized();
    setAudioReady(ok);
    if (ok) {
      audio.setTempo(bpm, 1);
      audio.setMasterVolume(masterGain);
      audio.stop();
    }
    return () => {
      audio.stop();
      for (let i = 0; i < 4; i++) audio.clearTrack(i);
      audio.deinitAudio();
    };
  }, []);

  useEffect(() => {
    if (!audioReady) return;
    audio.setTempo(bpm, 1);
  }, [audioReady, bpm]);

  useEffect(() => {
    if (!audioReady) return;
    audio.setMasterVolume(masterGain);
  }, [audioReady, masterGain]);

  useEffect(() => {
    if (!audioReady) return;
    if (isPlaying) audio.play();
    else audio.pause();
  }, [audioReady, isPlaying]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!audioReady) {
        setPeak(0);
        setCallbackUs(0);
        return;
      }
      const playhead = audio.getPlayhead();
      const step = Math.floor(Math.max(0, playhead - 1) * 16) % 16;
      setCurrentStep(step);
      setPeak(audio.getPeakLevel());
      setCallbackUs(audio.getCallbackTime());
    }, 80);
    return () => clearInterval(timer);
  }, [audioReady]);

  const updateSelectedTrack = (fn: (track: Track) => Track) => {
    setTracks((prev) => prev.map((track, index) => index === selectedTrackIndex ? fn(track) : track));
  };

  const adjustParam = (key: keyof TrackParams, delta: number) => {
    updateSelectedTrack((track) => {
      const next = { ...track.params };
      if (key === 'pan') next[key] = clamp(next[key] + delta, -1, 1);
      else if (key === 'nudge') next[key] = clamp(next[key] + delta, -0.35, 0.35);
      else next[key] = clamp(next[key] + delta, 0, 1);
      return { ...track, params: next };
    });
  };

  const cycleSelectedSound = () => {
    updateSelectedTrack((track) => {
      const currentIndex = SOUND_PRESETS.findIndex((preset) => preset.sound === track.sound);
      const next = SOUND_PRESETS[(currentIndex + 1 + SOUND_PRESETS.length) % SOUND_PRESETS.length];
      return swapSound(track, next.sound);
    });
  };

  const randomizeSelectedTrack = () => {
    updateSelectedTrack((track) => {
      const probability = track.sound === AUDIO_SOUND.hat ? 0.72 : track.sound >= AUDIO_SOUND.bass ? 0.42 : 0.34;
      const steps = track.steps.map(() => {
        if (Math.random() > probability) return 0 as StepLevel;
        return (Math.random() > 0.78 ? 2 : 1) as StepLevel;
      }) as StepLevel[];
      return { ...track, steps };
    });
  };

  const clearSelectedTrack = () => {
    updateSelectedTrack((track) => ({ ...track, steps: GRID.map(() => 0 as StepLevel) }));
  };

  const resetTransport = () => {
    audio.stop();
    audio.setPlayhead(1);
    setIsPlaying(false);
    setCurrentStep(0);
  };

  return (
    <ScrollView style={{ width: '100%', height: '100%', backgroundColor: '#ede7db' }}>
      {tracks.map((track, index) => (
        <AudioControls.PatternTrack
          key={track.id}
          enabled={audioReady}
          track={index}
          sound={track.sound}
          steps={track.steps}
          volume={track.params.volume}
          pan={track.params.pan}
          probability={track.params.probability}
          offset={track.params.nudge}
          swing={swing}
          start={1}
          stepsPerMeasure={16}
        />
      ))}
      <Box style={{ width: '100%', alignItems: 'center', paddingTop: 18, paddingBottom: 30 }}>
        <Box style={{ width: 320, alignItems: 'center', gap: 10 }}>
          <Box style={{ width: 218, height: 46, borderRadius: 24, backgroundColor: '#2f3134', justifyContent: 'center', alignItems: 'center' }}>
            <Text fontSize={10} color="#e5b04c">audio operator</Text>
          </Box>

          <Box style={{ width: 320, backgroundColor: '#0e0f10', borderRadius: 18, padding: 12, gap: 10, borderWidth: 1, borderColor: '#292a2d' }}>
            <Box style={{ flexDirection: 'row', justifyContent: 'spaceBetween', alignItems: 'center' }}>
              <Box>
                <Text fontSize={20} color="#f2b03b">ao</Text>
                <Text fontSize={9} color="#d0d0d0">pattern api // track sequencer</Text>
              </Box>
              <Box style={{ alignItems: 'flexEnd' }}>
                <Text fontSize={8} color="#7e8387">model</Text>
                <Text fontSize={11} color="#f2b03b">API-01</Text>
              </Box>
            </Box>

            <Box style={{ backgroundColor: '#c7c3b4', borderRadius: 6, borderWidth: 2, borderColor: '#5d5b52', padding: 8, gap: 6 }}>
              <Box style={{ flexDirection: 'row', justifyContent: 'spaceBetween', alignItems: 'center' }}>
                <Text fontSize={8} color="#222222">{isPlaying ? 'PLAY' : 'READY'}</Text>
                <Text fontSize={8} color="#222222">{selectedSoundLabel.toUpperCase()}</Text>
                <Text fontSize={8} color="#222222">{`STEP ${currentStep + 1}`}</Text>
              </Box>

              <AudioControls.StepMeter steps={selectedTrack.steps} currentStep={isPlaying ? currentStep : -1} color={selectedTrack.color} />

              <Box style={{ flexDirection: 'row', justifyContent: 'spaceBetween', alignItems: 'center' }}>
                <Text fontSize={9} color="#222222">{`bpm ${bpm}`}</Text>
                <Text fontSize={9} color="#222222">{`swing ${Math.round(swing * 100)}%`}</Text>
                <Text fontSize={9} color="#222222">{`cpu ${Math.round(callbackUs)}us`}</Text>
              </Box>

              <AudioControls.LevelMeter label="peak" value={peak} segments={10} color={selectedTrack.color} inactiveColor="#898679" />
            </Box>

            <Box style={{ flexDirection: 'row', gap: 10, alignItems: 'flexStart' }}>
              <AudioControls.Knob
                label="volume"
                value={selectedTrack.params.volume}
                min={0}
                max={1}
                step={0.05}
                color={selectedTrack.color}
                onChange={(value: number) => updateSelectedTrack((track) => ({ ...track, params: { ...track.params, volume: value } }))}
              />
              <AudioControls.Knob
                label="pan"
                value={selectedTrack.params.pan}
                min={-1}
                max={1}
                step={0.1}
                color={selectedTrack.color}
                onChange={(value: number) => updateSelectedTrack((track) => ({ ...track, params: { ...track.params, pan: value } }))}
              />
              <Box style={{ flexGrow: 1, gap: 6 }}>
                <SmallButton label={`sound ${selectedSoundLabel}`} onPress={cycleSelectedSound} accent={selectedTrack.color} />
                <SmallButton label={`bpm ${bpm}`} onPress={() => setBpm((v) => v >= 320 ? 72 : clamp(v + 4, 72, 320))} accent="#f2b03b" />
                <SmallButton
                  label={`prob ${Math.round(selectedTrack.params.probability * 100)}%`}
                  onPress={() => updateSelectedTrack((track) => ({
                    ...track,
                    params: {
                      ...track.params,
                      probability: track.params.probability >= 0.98 ? 0.32 : clamp(track.params.probability + 0.08, 0, 1),
                    },
                  }))}
                  accent={selectedTrack.color}
                />
                <SmallButton label={`swing ${Math.round(swing * 100)}%`} onPress={() => setSwing((v) => v >= 0.32 ? 0 : clamp(v + 0.04, 0, 0.32))} accent="#f2b03b" />
              </Box>
            </Box>

            <AudioControls.TrackSelector
              tracks={tracks}
              selected={selectedTrackIndex}
              onSelect={setSelectedTrackIndex}
              getId={(track: Track) => track.id}
              getLabel={(track: Track) => `track ${track.label}`}
              getColor={(track: Track) => track.color}
              getSubtitle={(track: Track) => soundLabel(track.sound)}
            />

            <AudioControls.StepPattern
              steps={selectedTrack.steps}
              currentStep={isPlaying ? currentStep : -1}
              color={selectedTrack.color}
              onChange={(steps: StepLevel[]) => updateSelectedTrack((track) => ({ ...track, steps }))}
            />

            <Box style={{ flexDirection: 'row', gap: 6 }}>
              <SmallButton label={isPlaying ? 'pause' : 'play'} onPress={() => setIsPlaying((v) => !v)} accent="#f2b03b" active={isPlaying} />
              <SmallButton label="reset" onPress={resetTransport} accent="#f2b03b" />
              <SmallButton label="random" onPress={randomizeSelectedTrack} accent={selectedTrack.color} />
              <SmallButton label="clear" onPress={clearSelectedTrack} accent="#ff744a" />
            </Box>

            <Box style={{ gap: 4, paddingTop: 2 }}>
              <Text fontSize={8} color="#8a8a8a">{`track ${selectedTrack.label} · ${selectedSoundLabel} · active ${activeCount}/16`}</Text>
              <Text fontSize={8} color="#8a8a8a">{`pan ${selectedTrack.params.pan.toFixed(2)} · probability ${selectedTrack.params.probability.toFixed(2)} · master ${masterGain.toFixed(2)} · audio ${audioReady ? 'online' : 'offline'}`}</Text>
            </Box>

            <Box style={{ flexDirection: 'row', gap: 6 }}>
              <SmallButton label="nudge +" onPress={() => adjustParam('nudge', 0.04)} accent={selectedTrack.color} />
              <SmallButton label="nudge -" onPress={() => adjustParam('nudge', -0.04)} accent={selectedTrack.color} />
              <SmallButton label="level +" onPress={() => setMasterGain((v) => clamp(v + 0.04, 0.2, 1.0))} accent="#f2b03b" />
              <SmallButton label="level -" onPress={() => setMasterGain((v) => clamp(v - 0.04, 0.2, 1.0))} accent="#f2b03b" />
            </Box>
          </Box>

          <Box style={{ width: 320, alignItems: 'center', gap: 4, paddingTop: 2 }}>
            <Text fontSize={24} color="#0f1720">API-01</Text>
            <Text fontSize={12} color="#0f1720">host-managed pattern sequencer</Text>
            <Text fontSize={10} color="#5b6470">useAudio hook, Zig timeline, transport-owned steps</Text>
          </Box>
        </Box>
      </Box>
    </ScrollView>
  );
}
