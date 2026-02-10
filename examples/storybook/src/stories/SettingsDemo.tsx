import React, { useState } from 'react';
import { Box, Text, Pressable, TextInput, Slider, Switch } from '../../../../packages/shared/src';
import { Checkbox } from '../../../../packages/shared/src/Checkbox';
import { Radio, RadioGroup } from '../../../../packages/shared/src/Radio';
import { Select } from '../../../../packages/shared/src/Select';

// ── Helpers ──────────────────────────────────────────────

function SectionHeader({ children }: { children: string }) {
  return (
    <Text style={{ color: '#e2e8f0', fontSize: 16, fontWeight: '700' }}>
      {children}
    </Text>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ color: '#cbd5e1', fontSize: 14 }}>{label}</Text>
      {children}
    </Box>
  );
}

function KeybindRow({ action, keyName, last }: { action: string; keyName: string; last?: boolean }) {
  return (
    <Box style={{
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 10,
      borderLeftWidth: 3,
      borderLeftColor: '#3b82f6',
      borderBottomWidth: last ? 0 : 1,
      borderBottomColor: '#1e293b',
    }}>
      <Text style={{ color: '#cbd5e1', fontSize: 14 }}>{action}</Text>
      <Box style={{
        backgroundColor: '#334155',
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 4,
        paddingBottom: 4,
        borderRadius: 4,
      }}>
        <Text style={{ color: '#94a3b8', fontSize: 12 }}>{keyName}</Text>
      </Box>
    </Box>
  );
}

// ── Main Demo ────────────────────────────────────────────

export function SettingsDemoStory() {
  // Profile
  const [playerName, setPlayerName] = useState('Commander Shepard');

  // Audio
  const [masterVol, setMasterVol] = useState(0.8);
  const [musicVol, setMusicVol] = useState(0.6);
  const [sfxVol, setSfxVol] = useState(0.9);

  // Display
  const [resolution, setResolution] = useState('1920x1080');
  const [quality, setQuality] = useState('high');
  const [fullscreen, setFullscreen] = useState(true);
  const [vsync, setVsync] = useState(true);
  const [showFps, setShowFps] = useState(false);

  // Difficulty
  const [difficulty, setDifficulty] = useState('normal');

  // Gameplay
  const [autoSave, setAutoSave] = useState(true);
  const [tutorials, setTutorials] = useState(true);
  const [screenShake, setScreenShake] = useState(true);

  return (
    <Box style={{ gap: 20, padding: 16 }}>

        {/* ── Title ──────────────────────────────── */}
        <Text style={{
          color: '#e2e8f0',
          fontSize: 22,
          fontWeight: '700',
          textDecorationLine: 'underline',
        }}>
          Game Settings
        </Text>

        {/* ── Profile Card ───────────────────────── */}
        <Box style={{
          borderRadius: 12,
          overflow: 'hidden',
        }}>
          {/* Gradient header */}
          <Box style={{
            backgroundGradient: {
              direction: 'horizontal',
              colors: ['#1e3a5f', '#0f172a'],
            },
            padding: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}>
            {/* Avatar circle */}
            <Box style={{
              width: 56,
              height: 56,
              aspectRatio: 1,
              borderRadius: 28,
              backgroundColor: '#3b82f6',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '700' }}>CS</Text>
            </Box>
            <Box style={{ gap: 4, flexShrink: 1 }}>
              <TextInput
                value={playerName}
                onChangeText={setPlayerName}
                style={{
                  fontSize: 16,
                  color: '#e2e8f0',
                  borderWidth: 1,
                  borderColor: '#334155',
                  borderRadius: 6,
                  padding: 6,
                  backgroundColor: '#0f172a',
                }}
              />
              <Text style={{ color: '#64748b', fontSize: 11 }}>Level 42 -- Vanguard Class</Text>
            </Box>
          </Box>
        </Box>

        {/* ── Audio ──────────────────────────────── */}
        <Box style={{
          gap: 12,
          backgroundColor: '#1e293b',
          borderRadius: 10,
          padding: 14,
        }}>
          <SectionHeader>Audio</SectionHeader>

          <Box style={{ gap: 4 }}>
            <SettingRow label={`Master: ${Math.round(masterVol * 100)}%`}>
              <Box />
            </SettingRow>
            <Slider
              value={masterVol}
              onValueChange={setMasterVol}
              activeTrackColor="#3b82f6"
              style={{ width: 200 }}
            />
          </Box>

          <Box style={{ gap: 4 }}>
            <SettingRow label={`Music: ${Math.round(musicVol * 100)}%`}>
              <Box />
            </SettingRow>
            <Slider
              value={musicVol}
              onValueChange={setMusicVol}
              activeTrackColor="#8b5cf6"
              thumbColor="#8b5cf6"
              style={{ width: 200 }}
            />
          </Box>

          <Box style={{ gap: 4 }}>
            <SettingRow label={`SFX: ${Math.round(sfxVol * 100)}%`}>
              <Box />
            </SettingRow>
            <Slider
              value={sfxVol}
              onValueChange={setSfxVol}
              activeTrackColor="#f59e0b"
              thumbColor="#f59e0b"
              style={{ width: 200 }}
            />
          </Box>
        </Box>

        {/* ── Display ────────────────────────────── */}
        <Box style={{
          gap: 12,
          backgroundColor: '#1e293b',
          borderRadius: 10,
          padding: 14,
        }}>
          <SectionHeader>Display</SectionHeader>

          <Box style={{ gap: 8 }}>
            <Text style={{ color: '#94a3b8', fontSize: 12 }}>Resolution</Text>
            <Select
              value={resolution}
              onValueChange={setResolution}
              options={[
                { label: '1280 x 720', value: '1280x720' },
                { label: '1920 x 1080', value: '1920x1080' },
                { label: '2560 x 1440', value: '2560x1440' },
                { label: '3840 x 2160', value: '3840x2160' },
              ]}
            />
          </Box>

          <Box style={{ gap: 8 }}>
            <Text style={{ color: '#94a3b8', fontSize: 12 }}>Quality Preset</Text>
            <Select
              value={quality}
              onValueChange={setQuality}
              options={[
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
                { label: 'Ultra', value: 'ultra' },
              ]}
            />
          </Box>

          <Box style={{ gap: 6, marginTop: 4 }}>
            <Checkbox value={fullscreen} onValueChange={setFullscreen} label="Fullscreen" />
            <Checkbox value={vsync} onValueChange={setVsync} label="V-Sync" />
            <Checkbox value={showFps} onValueChange={setShowFps} label="Show FPS Counter" color="#22c55e" />
          </Box>
        </Box>

        {/* ── Difficulty ─────────────────────────── */}
        <Box style={{
          gap: 12,
          backgroundColor: '#1e293b',
          borderRadius: 10,
          padding: 14,
        }}>
          <SectionHeader>Difficulty</SectionHeader>
          <RadioGroup value={difficulty} onValueChange={setDifficulty}>
            <Radio value="easy" label="Easy" color="#22c55e" />
            <Radio value="normal" label="Normal" color="#3b82f6" />
            <Radio value="hard" label="Hard" color="#f59e0b" />
            <Radio value="nightmare" label="Nightmare" color="#ef4444" />
          </RadioGroup>
        </Box>

        {/* ── Gameplay ───────────────────────────── */}
        <Box style={{
          gap: 10,
          backgroundColor: '#1e293b',
          borderRadius: 10,
          padding: 14,
        }}>
          <SectionHeader>Gameplay</SectionHeader>
          <SettingRow label="Auto-save">
            <Switch value={autoSave} onValueChange={setAutoSave} />
          </SettingRow>
          <SettingRow label="Tutorials">
            <Switch value={tutorials} onValueChange={setTutorials} />
          </SettingRow>
          <SettingRow label="Screen Shake">
            <Switch value={screenShake} onValueChange={setScreenShake} />
          </SettingRow>
        </Box>

        {/* ── Keybinds (per-side borders) ─────────── */}
        <Box style={{
          gap: 8,
          backgroundColor: '#1e293b',
          borderRadius: 10,
          padding: 14,
        }}>
          <SectionHeader>Keybinds</SectionHeader>
          <Box style={{ borderRadius: 6, overflow: 'hidden', backgroundColor: '#0f172a' }}>
            <KeybindRow action="Move" keyName="WASD" />
            <KeybindRow action="Jump" keyName="Space" />
            <KeybindRow action="Attack" keyName="LMB" />
            <KeybindRow action="Dodge" keyName="Shift" />
            <KeybindRow action="Interact" keyName="E" last />
          </Box>
        </Box>

        {/* ── Status Bar (flexShrink demo) ────────── */}
        <Box style={{
          flexDirection: 'row',
          gap: 8,
          width: '100%',
        }}>
          <Box style={{
            flexShrink: 0,
            backgroundColor: '#22c55e',
            borderRadius: 6,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 6,
            paddingBottom: 6,
          }}>
            <Text style={{ color: '#0f172a', fontSize: 11, fontWeight: '700' }}>CPU: 45%</Text>
          </Box>
          <Box style={{
            flexShrink: 1,
            flexGrow: 1,
            backgroundColor: '#f59e0b',
            borderRadius: 6,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 6,
            paddingBottom: 6,
          }}>
            <Text style={{ color: '#0f172a', fontSize: 11, fontWeight: '700' }}>GPU: 72%</Text>
          </Box>
          <Box style={{
            flexShrink: 1,
            flexGrow: 1,
            backgroundColor: '#3b82f6',
            borderRadius: 6,
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 6,
            paddingBottom: 6,
          }}>
            <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}>RAM: 8.2 GB</Text>
          </Box>
        </Box>

        {/* ── Action Buttons ─────────────────────── */}
        <Box style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={() => {}}
            style={(state) => ({
              backgroundColor: state.pressed ? '#16a34a' : state.hovered ? '#22c55e' : '#15803d',
              paddingLeft: 18,
              paddingRight: 18,
              paddingTop: 10,
              paddingBottom: 10,
              borderRadius: 8,
            })}
          >
            {(state) => (
              <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>
                {state.pressed ? 'Saving...' : 'Save Settings'}
              </Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {}}
            style={(state) => ({
              backgroundColor: state.pressed ? '#475569' : state.hovered ? '#475569' : '#334155',
              paddingLeft: 18,
              paddingRight: 18,
              paddingTop: 10,
              paddingBottom: 10,
              borderRadius: 8,
            })}
          >
            <Text style={{ color: '#94a3b8', fontSize: 14 }}>Reset Defaults</Text>
          </Pressable>

          <Pressable
            onPress={() => {}}
            style={(state) => ({
              backgroundColor: 'transparent',
              borderWidth: 1,
              borderColor: state.hovered ? '#64748b' : '#334155',
              paddingLeft: 18,
              paddingRight: 18,
              paddingTop: 10,
              paddingBottom: 10,
              borderRadius: 8,
            })}
          >
            <Text style={{ color: '#64748b', fontSize: 14 }}>Back</Text>
          </Pressable>
        </Box>

    </Box>
  );
}
