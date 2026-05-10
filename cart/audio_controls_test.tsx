import { useEffect, useState } from 'react';
import { Audio, AudioControls, Box, Pressable, Text } from '@reactjit/runtime/primitives';
import { AUDIO_SOUND, useAudio } from '@reactjit/runtime/hooks';

type DemoTrack = {
  id: string;
  label: string;
  color: string;
  sound: number;
};

type Page = 'play' | 'sequence' | 'mix' | 'monitor';

const TRACKS: DemoTrack[] = [
  { id: 'a', label: 'Kick', color: '#f2b03b', sound: AUDIO_SOUND.kick },
  { id: 'b', label: 'Snare', color: '#58e3dd', sound: AUDIO_SOUND.snare },
  { id: 'c', label: 'Hat', color: '#8f70ff', sound: AUDIO_SOUND.hat },
];

const PAGES: Array<{ id: Page; label: string }> = [
  { id: 'play', label: 'Play' },
  { id: 'sequence', label: 'Sequence' },
  { id: 'mix', label: 'Mix' },
  { id: 'monitor', label: 'Monitor' },
];

function Panel({ title, children, style }: { title: string; children: any; style?: Record<string, any> }) {
  return (
    <Box style={{ gap: 8, padding: 10, borderWidth: 1, borderColor: '#2f3742', borderRadius: 8, backgroundColor: '#10151d', ...style }}>
      <Text fontSize={10} color="#d6dde8">{title}</Text>
      {children}
    </Box>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 92,
        height: 34,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: active ? '#f2b03b' : '#34404d',
        backgroundColor: active ? '#f2b03b' : '#141b25',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text fontSize={10} color={active ? '#111111' : '#d6dde8'}>{label}</Text>
    </Pressable>
  );
}

function AudioControlsTestSurface() {
  const audio = useAudio();
  const [page, setPage] = useState<Page>('play');
  const [steps, setSteps] = useState<Array<0 | 1 | 2>>([2, 0, 1, 0, 1, 0, 2, 0, 1, 0, 1, 0, 2, 0, 1, 0]);
  const [selected, setSelected] = useState(0);
  const [knob, setKnob] = useState(0.5);

  useEffect(() => {
    const ok = audio.initAudio() || audio.isAudioInitialized();
    if (ok) {
      audio.setTempo(120, 1);
      audio.setMasterVolume(0.5);
      audio.play();
    }
    return () => {
      audio.stop();
      audio.clearTrack(0);
      audio.clearTrack(1);
      audio.deinitAudio();
    };
  }, []);

  const selectedTrack = TRACKS[selected];

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#090d12', padding: 12, gap: 10 }}>
      <AudioControls.PatternTrack
        track={0}
        sound={selectedTrack.sound}
        steps={steps}
      />

      <Box style={{ flexDirection: 'row', justifyContent: 'spaceBetween', alignItems: 'center' }}>
        <Box>
          <Text fontSize={18} color="#f2b03b">AudioControls</Text>
          <Text fontSize={9} color="#8792a0">primitive workbench</Text>
        </Box>
        <AudioControls.LevelMeter value={0.6} color={selectedTrack.color} inactiveColor="#26313d" />
      </Box>

      <Box style={{ flexDirection: 'row', gap: 8 }}>
        {PAGES.map((item) => (
          <TabButton key={item.id} label={item.label} active={page === item.id} onPress={() => setPage(item.id)} />
        ))}
      </Box>

      {page === 'play' && (
        <Box style={{ flexDirection: 'row', gap: 12, alignItems: 'flexStart', flexGrow: 1 }}>
          <Box style={{ width: 270, gap: 12 }}>
            <Panel title="Transport">
              <AudioControls.Transport showTimeSig={false} />
            </Panel>
            <Panel title="Pads">
              <AudioControls.Pads
                target="voice"
                sounds={[AUDIO_SOUND.kick, AUDIO_SOUND.snare, AUDIO_SOUND.hat, AUDIO_SOUND.bass]}
              />
            </Panel>
          </Box>
          <Box style={{ flexGrow: 1, gap: 12 }}>
            <Panel title="Keybed">
              <AudioControls.Keybed target="voice" layout="grid" range={[48, 60]} />
            </Panel>
            <Panel title="Knob">
              <AudioControls.Knob label="macro" value={knob} onChange={setKnob} />
            </Panel>
          </Box>
        </Box>
      )}

      {page === 'sequence' && (
        <Box style={{ gap: 12, flexGrow: 1 }}>
          <Panel title="Track">
            <AudioControls.TrackSelector
              tracks={TRACKS}
              selected={selected}
              onSelect={setSelected}
              getLabel={(track: DemoTrack) => track.label}
              getColor={(track: DemoTrack) => track.color}
              getSubtitle={(track: DemoTrack) => String(track.sound)}
            />
          </Panel>
          <Panel title="Step Meter">
            <AudioControls.StepMeter steps={steps} currentStep={0} color={selectedTrack.color} />
          </Panel>
          <Panel title="Step Pattern">
            <AudioControls.StepPattern
              steps={steps}
              onChange={setSteps}
              color={selectedTrack.color}
              padWidth={42}
              padHeight={36}
            />
          </Panel>
          <Panel title="Step Grid">
            <AudioControls.StepGrid
              track={1}
              sounds={[AUDIO_SOUND.kick, AUDIO_SOUND.snare, AUDIO_SOUND.hat]}
            />
          </Panel>
        </Box>
      )}

      {page === 'mix' && (
        <Box style={{ flexDirection: 'row', gap: 12, alignItems: 'flexStart', flexGrow: 1 }}>
          <Box style={{ width: 300, gap: 12 }}>
            <Panel title="Sliders">
              <Box style={{ gap: 10 }}>
                <AudioControls.Slider target="voice" param="gain" orientation="horizontal" />
                <AudioControls.Slider target={0} property="volume" orientation="horizontal" />
                <AudioControls.Slider target="master" property="volume" orientation="horizontal" />
              </Box>
            </Panel>
            <Panel title="XY Pad">
              <AudioControls.XYPad target="voice" xParam="tone" yParam="drive" />
            </Panel>
          </Box>
          <Panel title="Module Panel" style={{ flexGrow: 1 }}>
            <AudioControls.ModulePanel id="voice" layout="grid" sliderOrientation="horizontal" />
          </Panel>
        </Box>
      )}

      {page === 'monitor' && (
        <Box style={{ flexDirection: 'row', gap: 12, alignItems: 'flexStart', flexGrow: 1 }}>
          <Panel title="Scope">
            <AudioControls.Scope />
          </Panel>
          <Panel title="Output">
            <AudioControls.LevelMeter value={0.6} label="peak" color={selectedTrack.color} inactiveColor="#26313d" />
          </Panel>
          <Panel title="Mounted Host Track">
            <Text fontSize={10} color="#d6dde8">{`track 0 -> ${selectedTrack.label}`}</Text>
            <Text fontSize={10} color="#8792a0">PatternTrack is mounted globally on this page.</Text>
          </Panel>
        </Box>
      )}
    </Box>
  );
}

export default function AudioControlsTestCart() {
  return (
    <Audio>
      <Audio.Module id="voice" type="instrument" voice={0} tone={0.5} decay={0.5} color={0.5} drive={0.2} gain={0.8} />
      <AudioControlsTestSurface />
    </Audio>
  );
}
