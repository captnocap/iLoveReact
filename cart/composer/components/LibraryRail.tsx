// LibraryRail — sample library + capture controls + input source.
//
// Each entry shows the id (what the user references in code), the
// label, and a remove button. Add-from-file opens a zenity picker;
// capture records the selected input device (default mic OR a chosen
// source — monitor/loopback devices show up here too, letting the
// cart capture system audio output without external routing).

import { useState } from 'react';
import { Col, Row, Box, Text, Pressable, ScrollView, TextInput } from '@reactjit/runtime/primitives';
import { Tooltip } from '@reactjit/runtime/tooltip/Tooltip';
import { COLORS, SIZES } from '../theme';
import type { ComposerState } from '../state';
import type { SampleRef } from '../domain';

interface Props {
  s: ComposerState;
}

export function LibraryRail({ s }: Props) {
  return (
    <Col style={{
      width: SIZES.libraryRail,
      backgroundColor: COLORS.panel,
      borderRightWidth: 1,
      borderRightColor: COLORS.border,
    }}>
      <Row style={{
        height: 36,
        alignItems: 'center',
        paddingLeft: 12,
        paddingRight: 12,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
        gap: 8,
      }}>
        <Text style={{ color: COLORS.inkDim, fontSize: 11, letterSpacing: 1, flexGrow: 1 }}>LIBRARY</Text>
        <Text style={{ color: COLORS.inkMuted, fontSize: 11 }}>{s.samples.length}</Text>
      </Row>

      <ScrollView style={{ flexGrow: 1, flexBasis: 0 }}>
        {s.samples.length === 0 ? (
          <Col style={{ padding: 14, gap: 6 }}>
            <Text style={{ color: COLORS.inkMuted, fontSize: 11, lineHeight: 16 }}>
              No samples yet. Add a WAV file to bind it as a global in your code.
            </Text>
            <Text style={{ color: COLORS.inkMuted, fontSize: 11, lineHeight: 16 }}>
              You'll be prompted for an identifier on import; click ✎ later to rename.
            </Text>
            <Text style={{ color: COLORS.inkMuted, fontSize: 11, lineHeight: 16 }}>
              Built-ins are always bound: kick · snare · hat · bass · lead.
            </Text>
          </Col>
        ) : (
          <Col style={{ padding: 6, gap: 4 }}>
            {s.samples.map((sample) => (
              <SampleRow key={sample.id} s={s} sample={sample} />
            ))}
          </Col>
        )}
      </ScrollView>

      <Col style={{
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
        padding: 8,
        gap: 6,
      }}>
        <InputDevicePicker s={s} />
        <Tooltip
          variant="sweatshop-ui"
          title="Add sample"
          label="Open a WAV file picker. The file is copied into the project (cart/composer/samples/<stem>/) and its id becomes a global binding inside the compile sandbox."
        >
          <Pressable
            onPress={() => { void s.addSampleFromFile(); }}
            style={{
              backgroundColor: COLORS.accentDim,
              paddingTop: 8,
              paddingBottom: 8,
              borderRadius: 4,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: COLORS.ink, fontSize: 12, fontWeight: '600' }}>+ add sample</Text>
          </Pressable>
        </Tooltip>
        <Tooltip
          variant="sweatshop-ui"
          title={s.isCapturing ? 'Stop capture' : 'Capture from mic'}
          label={s.isCapturing
            ? 'Stop recording and save the buffer as a WAV in this project. The new entry appears in the library immediately.'
            : 'Record from the default mic at 44.1kHz mono. Hard cap is 10 minutes; the status bar warns if you hit it.'}
        >
          <Pressable
            onPress={s.isCapturing ? s.stopCapture : s.startCapture}
            style={{
              backgroundColor: s.isCapturing ? COLORS.bad : COLORS.bgSoft,
              paddingTop: 8,
              paddingBottom: 8,
              borderRadius: 4,
              alignItems: 'center',
              gap: 4,
            }}
          >
          <Row style={{ alignItems: 'center', gap: 6 }}>
            <Box style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: s.isCapturing ? COLORS.ink : COLORS.bad,
            }} />
            <Text style={{
              color: s.isCapturing ? COLORS.ink : COLORS.inkDim,
              fontSize: 12,
              fontWeight: '600',
            }}>
              {s.isCapturing ? 'stop capture' : 'capture from mic'}
            </Text>
          </Row>
          {s.isCapturing ? (
            <Box style={{
              width: '100%',
              height: 3,
              backgroundColor: COLORS.bg,
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <Box style={{
                width: `${Math.round(s.captureLevel * 100)}%`,
                height: '100%',
                backgroundColor: COLORS.ink,
              }} />
            </Box>
          ) : null}
          </Pressable>
        </Tooltip>
      </Col>
    </Col>
  );
}

// ── Sample row ──────────────────────────────────────────────────────
// Display mode shows the id (code-facing) above the label (display name),
// with a pencil to enter edit mode and an ✕ to remove. Edit mode swaps
// the id Text for a TextInput; Enter commits via s.renameSample (which
// runs validateSampleId — collisions and reserved names are rejected
// with a status-bar message and the row stays in edit mode so the user
// can fix the name without losing what they typed).

function SampleRow({ s, sample }: { s: ComposerState; sample: SampleRef }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sample.id);

  const startEdit = () => { setDraft(sample.id); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const commitEdit = () => {
    setEditing(false);
    if (draft && draft !== sample.id) s.renameSample(sample.id, draft);
  };

  return (
    <Tooltip
      variant="sweatshop-ui"
      title={sample.id}
      label={`${sample.source === 'captured' ? 'Captured' : 'Imported'} · ${sample.path}`}
      rows={[
        { label: 'reference', value: `makeBeat(${sample.id}, 0, 1, '0-0-0-0-')` },
      ]}
    >
      <Row
        style={{
          backgroundColor: COLORS.panelAlt,
          borderRadius: 4,
          paddingLeft: 10,
          paddingRight: 6,
          paddingTop: 6,
          paddingBottom: 6,
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Col style={{ flexGrow: 1, flexBasis: 0, gap: 1 }}>
          {editing ? (
            <TextInput
              value={draft}
              onChange={(v: string) => setDraft(v)}
              onSubmit={commitEdit}
              style={{
                backgroundColor: COLORS.bg,
                color: COLORS.tokSynth,
                borderWidth: 1,
                borderColor: COLORS.accentDim,
                borderRadius: 3,
                paddingLeft: 6,
                paddingRight: 6,
                paddingTop: 2,
                paddingBottom: 2,
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            />
          ) : (
            <Text style={{ color: COLORS.tokSynth, fontSize: 12, fontFamily: 'monospace' }}>
              {sample.id}
            </Text>
          )}
          <Text style={{ color: COLORS.inkMuted, fontSize: 10 }}>
            {sample.label}
          </Text>
        </Col>
        {editing ? (
          <>
            <Pressable
              onPress={commitEdit}
              style={iconBtnStyle(COLORS.accentDim)}
            >
              <Text style={{ color: COLORS.ink, fontSize: 10 }}>✓</Text>
            </Pressable>
            <Pressable
              onPress={cancelEdit}
              style={iconBtnStyle(COLORS.bgSoft)}
            >
              <Text style={{ color: COLORS.inkDim, fontSize: 10 }}>↶</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={startEdit}
              style={iconBtnStyle(COLORS.bgSoft)}
            >
              <Text style={{ color: COLORS.inkDim, fontSize: 10 }}>✎</Text>
            </Pressable>
            <Pressable
              onPress={() => s.removeSample(sample.id)}
              style={iconBtnStyle(COLORS.bgSoft)}
            >
              <Text style={{ color: COLORS.inkDim, fontSize: 10 }}>✕</Text>
            </Pressable>
          </>
        )}
      </Row>
    </Tooltip>
  );
}

function iconBtnStyle(bg: string) {
  return {
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 2,
    paddingBottom: 2,
    borderRadius: 3,
    backgroundColor: bg,
  };
}

// ── Device picker ───────────────────────────────────────────────────
// Compact inline expander. Closed: shows the selected device name (or
// "default"). Open: lists every device the SDL3 input subsystem
// reports — physical mics PLUS any monitor / loopback devices the
// OS exposes (PipeWire / PulseAudio surface system-audio monitors as
// recording devices, so picking one captures whatever the speakers
// are playing). Clicking a row selects it and collapses the picker.

function InputDevicePicker({ s }: { s: ComposerState }) {
  const [open, setOpen] = useState(false);
  const current = s.selectedInputDeviceName ?? 'default';
  const empty = s.inputDevices.length === 0;

  return (
    <Col style={{ gap: 4 }}>
      <Tooltip
        variant="sweatshop-ui"
        title="Input source"
        label="The device capture pulls from. PipeWire / PulseAudio expose monitor (system-audio loopback) devices here too, so you can sample whatever your speakers are playing without external routing."
      >
        <Pressable
          onPress={() => {
            if (!open) s.refreshInputDevices();
            setOpen((v) => !v);
          }}
          style={{
            backgroundColor: COLORS.bgSoft,
            paddingLeft: 10,
            paddingRight: 8,
            paddingTop: 6,
            paddingBottom: 6,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: open ? COLORS.accentDim : COLORS.border,
          }}
        >
          <Row style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ color: COLORS.inkMuted, fontSize: 10 }}>input:</Text>
            <Text style={{
              color: COLORS.ink,
              fontSize: 11,
              flexGrow: 1,
              flexBasis: 0,
            }}>
              {truncate(current, 22)}
            </Text>
            <Text style={{ color: COLORS.inkDim, fontSize: 10 }}>{open ? '▴' : '▾'}</Text>
          </Row>
        </Pressable>
      </Tooltip>

      {open ? (
        // No ScrollView here — it needs explicit height and collapsed to 0
        // in this layout (CLAUDE.md flex rule). With 5–10 devices the list
        // fits comfortably; if a user ever has more, we can add scroll back.
        <Col style={{
          backgroundColor: COLORS.panelAlt,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: COLORS.border,
        }}>
          <Row style={{
            paddingLeft: 10,
            paddingRight: 6,
            paddingTop: 5,
            paddingBottom: 5,
            alignItems: 'center',
            gap: 6,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.border,
            backgroundColor: COLORS.bg,
          }}>
            <Tooltip
              variant="sweatshop-ui"
              title="Raw SDL device names"
              label={[
                'recording:',
                ...s.inputDevices.map((d) => `  [${d.id}] ${d.name || '(no name)'}`),
                '',
                'playback:',
                ...s.outputDevices.map((d) => `  [${d.id}] ${d.name || '(no name)'}`),
              ].join('\n')}
            >
              <Text style={{ color: COLORS.inkMuted, fontSize: 10, flexGrow: 1 }}>
                {`SDL: ${s.inputDevices.length} recording · ${s.outputDevices.length} playback (hover for names)`}
              </Text>
            </Tooltip>
            <Pressable
              onPress={s.refreshInputDevices}
              style={{
                paddingLeft: 6,
                paddingRight: 6,
                paddingTop: 2,
                paddingBottom: 2,
                borderRadius: 3,
                backgroundColor: COLORS.bgSoft,
              }}
            >
              <Text style={{ color: COLORS.inkDim, fontSize: 10 }}>↻ refresh</Text>
            </Pressable>
          </Row>
          <DeviceRow
            label="System default mic"
            sublabel="whichever recording device the OS routes audio from"
            selected={s.selectedInputDeviceName === null}
            onPress={() => { s.setInputDevice(null); setOpen(false); }}
          />
          {empty ? (
            <Text style={{
              color: COLORS.inkMuted,
              fontSize: 10,
              padding: 10,
              lineHeight: 14,
            }}>
              SDL3 reports no recording devices. On Linux this usually means PipeWire/Pulse isn't exposing any sources to SDL — try `pactl list short sources` to confirm what the OS sees, then hit ↻ refresh.
            </Text>
          ) : (
            <DeviceGroupedList
              devices={s.inputDevices}
              outputs={s.outputDevices}
              selectedName={s.selectedInputDeviceName}
              onPick={(d) => { s.setInputDevice(d); setOpen(false); }}
            />
          )}
        </Col>
      ) : null}
    </Col>
  );
}

// ── Device grouping ─────────────────────────────────────────────────
// On Linux, SDL_GetAudioRecordingDevices returns physical mics AND
// PipeWire/Pulse "monitor" sources (which read whatever a given output
// device is currently playing — effectively a system-audio loopback).
// They share one flat list with cryptic names like "Monitor of HDMI
// Output", so the user has to know that "Monitor of <X>" means "capture
// what's playing through <X>". We bridge that gap by ALSO reading the
// SDL playback-device list and presenting each output by its friendly
// name with its matching loopback recording device under the hood — so
// the user sees "Built-in Speakers" instead of "Monitor of alsa_output.…".

interface AudioInputDevice { id: number; name: string }
interface AudioOutputDevice { id: number; name: string }

/** Pair an output device with its best-matching recording device.
 *  The pairing is intentionally loose because OS-level audio backends
 *  use wildly different naming conventions. Tries in order:
 *   - PipeWire: `<output>.monitor`
 *   - PulseAudio: `Monitor of <output>`
 *   - Generic: recording name contains the output name (or vice versa)
 *   - Same-name pairing: recording name equals output name (some SDL
 *     backends just surface the same device under both lists)
 *  Returns the matching recording or null. */
function findLoopbackFor(
  output: AudioOutputDevice,
  recordings: AudioInputDevice[],
): AudioInputDevice | null {
  const outName = (output.name || '').trim();
  if (!outName) return null;
  const outLower = outName.toLowerCase();
  for (const rec of recordings) {
    const rLower = (rec.name || '').toLowerCase();
    if (rLower === outLower) return rec;
    if (rLower === outLower + '.monitor') return rec;
    if (rLower === `monitor of ${outLower}`) return rec;
    if (rLower.includes(outLower) || outLower.includes(rLower)) return rec;
  }
  return null;
}

function DeviceGroupedList({
  devices,
  outputs,
  selectedName,
  onPick,
}: {
  devices: AudioInputDevice[];
  outputs: AudioOutputDevice[];
  selectedName: string | null;
  onPick: (d: AudioInputDevice) => void;
}) {
  // Pair each output with its best-guess matching recording device.
  // Recording devices NOT paired to any output land in the mic bucket —
  // that way nothing is hidden, even when the naming heuristic fails.
  const pairs: Array<{ output: AudioOutputDevice; loopback: AudioInputDevice }> = [];
  const matchedRecIds = new Set<number>();
  for (const out of outputs) {
    const rec = findLoopbackFor(out, devices.filter((d) => !matchedRecIds.has(d.id)));
    if (rec) {
      pairs.push({ output: out, loopback: rec });
      matchedRecIds.add(rec.id);
    }
  }
  const mics = devices.filter((d) => !matchedRecIds.has(d.id));

  return (
    <Col>
      {pairs.length > 0 ? (
        <>
          <DeviceGroupHeader
            title="Capture from output"
            hint="record what's playing through this speaker/headphone"
          />
          {pairs.map(({ output, loopback }) => (
            <DeviceRow
              key={`out:${output.id}:${output.name}`}
              label={output.name || `Output ${output.id}`}
              sublabel={`via ${loopback.name || `id ${loopback.id}`}`}
              selected={selectedName === loopback.name}
              onPress={() => onPick(loopback)}
            />
          ))}
        </>
      ) : null}
      {mics.length > 0 ? (
        <>
          <DeviceGroupHeader
            title="Other recording devices"
            hint="microphones + anything the output-pairing heuristic didn't match"
          />
          {mics.map((d) => (
            <DeviceRow
              key={`mic:${d.id}:${d.name}`}
              label={d.name || `Device ${d.id}`}
              sublabel={`id ${d.id}`}
              selected={selectedName === d.name}
              onPress={() => onPick(d)}
            />
          ))}
        </>
      ) : null}
    </Col>
  );
}

function DeviceGroupHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <Col style={{
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 6,
      paddingBottom: 3,
      backgroundColor: COLORS.bg,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
    }}>
      <Text style={{ color: COLORS.inkDim, fontSize: 9, letterSpacing: 1 }}>
        {title.toUpperCase()}
      </Text>
      <Text style={{ color: COLORS.inkMuted, fontSize: 9 }}>
        {hint}
      </Text>
    </Col>
  );
}

function DeviceRow({
  label,
  sublabel,
  selected,
  onPress,
}: {
  label: string;
  sublabel: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 5,
        paddingBottom: 5,
        backgroundColor: selected ? COLORS.panelHi : 'transparent',
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
      }}
    >
      <Row style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{ color: selected ? COLORS.tokSynth : COLORS.inkDim, fontSize: 10 }}>
          {selected ? '●' : '○'}
        </Text>
        <Col style={{ flexGrow: 1, flexBasis: 0, gap: 1 }}>
          <Text style={{ color: COLORS.ink, fontSize: 11 }}>
            {label}
          </Text>
          <Text style={{ color: COLORS.inkMuted, fontSize: 9 }}>
            {sublabel}
          </Text>
        </Col>
      </Row>
    </Pressable>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
