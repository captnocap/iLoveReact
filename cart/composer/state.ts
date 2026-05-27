// state.ts — composer cart single source of truth.
//
// Layout mirrors cart/cutout/state.ts: declare every piece of cart
// state, expose a hook returning everything components need, route
// persistence/history/keyboard through runtime/workspace's
// useWorkspace.
//
// The cart's "compiled" state (what's currently scheduled in the audio
// framework) is transient — only the source text persists. Hitting
// Ctrl+S takes the current editor text, compiles it, and dispatches
// into framework/audio. Undo restores the prior source; the user
// re-Ctrl+S's to hear it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudio } from '@reactjit/runtime/audio';
import { useWorkspace, type SessionEnvelope } from '@reactjit/runtime/workspace';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import { useAudioInput, type AudioInputDevice, type AudioOutputDevice } from '@reactjit/runtime/hooks/useAudioInput';
import { mkdir, exists } from '@reactjit/runtime/hooks/fs';
import { execAsync } from '@reactjit/runtime/hooks/process';
import {
  searchSource,
  importSampleAsWav,
  availableSources,
  credentials,
  type NormalizedSample,
  type SearchPage,
  type SearchQuery,
  type SourceId,
} from './sources';
import {
  CART_NAME,
  SESSION_VERSION,
  samplesDirFor,
  samplePathFor,
} from './session';
import {
  type ComposerPayload,
  type SampleRef,
  type UiPrefs,
  DEFAULT_SOURCE,
  DEFAULT_UI_PREFS,
  DEFAULT_MASTER_VOLUME,
  sanitizeSampleId,
  basenameStem,
  validateSampleId,
} from './domain';
import { compileAndRun, type CompileResult, STATIC_SANDBOX_NAMES } from './compiler';

const RESERVED_SANDBOX_NAMES: ReadonlySet<string> = new Set(STATIC_SANDBOX_NAMES);

export interface ComposerState {
  // Workspace identity + persistence
  stem: string;
  setStem: (s: string) => void;
  lastSavedAt: number | null;
  restoredFrom: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;

  // Editor
  source: string;
  setSource: (s: string) => void;
  insertSnippet: (snippet: string) => void;

  // Library
  samples: SampleRef[];
  addSampleFromFile: () => Promise<void>;
  removeSample: (id: string) => void;
  renameSample: (id: string, nextId: string) => void;

  // Online sample sources (Freesound, …). Token handling is temporary
  // (localstore via sources/credentials); real data layer next iteration.
  availableSources: SourceId[];
  searchSources: (source: SourceId, query: SearchQuery) => Promise<SearchPage>;
  addSampleFromSource: (sample: NormalizedSample) => Promise<void>;
  setSourceToken: (source: SourceId, token: string) => void;

  // Mic capture (raw, 44.1kHz mono → WAV at samplesDirFor(stem))
  isCapturing: boolean;
  captureLevel: number;
  startCapture: () => void;
  stopCapture: () => void;

  // Input source — selectable device. Includes physical mics AND any
  // monitor/loopback devices the OS exposes (PipeWire / PulseAudio),
  // so the user can capture system audio output without external
  // routing. Persists by name (ids are dynamic across reboots).
  inputDevices: AudioInputDevice[];
  refreshInputDevices: () => void;
  /** Playback devices the OS exposes (speakers/headphones/HDMI). Useful
   *  for the picker to surface "capture from <speaker name>" rows that
   *  resolve to the matching loopback recording device by name. */
  outputDevices: AudioOutputDevice[];
  /** Display name of the selected device. null = SDL3 default. */
  selectedInputDeviceName: string | null;
  /** Resolved id for the selected device — derived from the name +
   *  current device list. 0 when the selection is null or unresolvable
   *  (Zig side treats 0 as "use default"). */
  selectedInputDeviceId: number;
  /** Pass the AudioInputDevice (or null to revert to default). */
  setInputDevice: (device: AudioInputDevice | null) => void;

  // Project tempo (default before user-code setTempo runs)
  tempo: number;
  setTempo: (n: number) => void;

  // Master output volume (0..1). Pushed to audio.setMasterVolume on
  // mount, on restore, and on every slider drag.
  masterVolume: number;
  setMasterVolume: (v: number) => void;

  // Transport
  isPlaying: boolean;
  togglePlay: () => void;
  stop: () => void;

  // Compile state
  compile: () => void;
  lastCompile: CompileResult | null;

  // UI prefs
  uiPrefs: UiPrefs;
  setFontSize: (n: number) => void;

  // Cheat sheet overlay
  isCheatSheetOpen: boolean;
  openCheatSheet: () => void;
  closeCheatSheet: () => void;
  toggleCheatSheet: () => void;

  // Status
  status: string;
}

export function useComposerState(): ComposerState {
  const audio = useAudio();
  // useAudioInput with kind='raw' delegates to useRawCapture AND adds
  // the shared device enumeration on top — same backend as before,
  // plus the device list we need for the picker.
  const audioInput = useAudioInput({ kind: 'raw' });

  // ── Persisted state ────────────────────────────────────────────────
  const [source, setSourceRaw] = useState<string>(DEFAULT_SOURCE);
  const [tempo, setTempoRaw] = useState<number>(120);
  const [samples, setSamples] = useState<SampleRef[]>([]);
  const [uiPrefs, setUiPrefsRaw] = useState<UiPrefs>(DEFAULT_UI_PREFS);
  const [selectedInputDeviceName, setSelectedInputDeviceName] = useState<string | null>(null);
  const [masterVolume, setMasterVolumeRaw] = useState<number>(DEFAULT_MASTER_VOLUME);

  // ── Transient state ────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastCompile, setLastCompile] = useState<CompileResult | null>(null);
  const [status, setStatus] = useState<string>('ready — Ctrl+S to compile');
  const [isCheatSheetOpen, setIsCheatSheetOpen] = useState(false);
  const openCheatSheet = useCallback(() => setIsCheatSheetOpen(true), []);
  const closeCheatSheet = useCallback(() => setIsCheatSheetOpen(false), []);
  const toggleCheatSheet = useCallback(() => setIsCheatSheetOpen((v) => !v), []);

  // Mirror state into refs so the IFTTT-bound Ctrl+S handler always
  // reads the LATEST values, not the values frozen at first bind.
  const sourceRef = useRef(source); sourceRef.current = source;
  const samplesRef = useRef(samples); samplesRef.current = samples;

  // ── Workspace persistence ──────────────────────────────────────────
  const buildPayload = useCallback((): ComposerPayload | null => {
    return {
      source: sourceRef.current,
      tempo,
      samples: samplesRef.current.map((s) => ({ ...s })),
      inputDeviceName: selectedInputDeviceName,
      masterVolume,
      uiPrefs: { ...uiPrefs },
    };
  }, [tempo, uiPrefs, selectedInputDeviceName, masterVolume]);

  const applyPayload = useCallback((env: SessionEnvelope<ComposerPayload>) => {
    const p = env.payload;
    setSourceRaw(p.source ?? DEFAULT_SOURCE);
    setTempoRaw(Number.isFinite(p.tempo) ? p.tempo : 120);
    setSamples((p.samples ?? []).map((s) => ({ ...s })));
    setSelectedInputDeviceName(p.inputDeviceName ?? null);
    setMasterVolumeRaw(Number.isFinite(p.masterVolume) ? p.masterVolume : DEFAULT_MASTER_VOLUME);
    setUiPrefsRaw({
      fontSize: p.uiPrefs?.fontSize ?? DEFAULT_UI_PREFS.fontSize,
    });
    setStatus(`restored · ${env.stem}`);
  }, []);

  const ws = useWorkspace<ComposerPayload>({
    cartName: CART_NAME,
    version: SESSION_VERSION,
    buildPayload,
    applyPayload,
    deps: [source, tempo, samples, uiPrefs, selectedInputDeviceName, masterVolume],
    initialStem: 'untitled',
  });

  // ── Initialize the audio framework on mount ────────────────────────
  useEffect(() => {
    audio.initAudio();
    return () => { audio.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push masterVolume into the audio engine on mount, on restore, and on
  // every change. The audio framework persists this internally but the
  // cart's session is the source of truth, so we always push our value.
  useEffect(() => {
    audio.setMasterVolume(masterVolume);
  }, [audio, masterVolume]);

  // ── Wrapped setters that snapshot to history at sensible boundaries ─
  const setSource = useCallback((next: string) => {
    // Coalesce typing — first edit in a 250ms window commits, so undo
    // doesn't restore every keystroke.
    ws.commitCoalesced();
    setSourceRaw(next);
  }, [ws]);

  const insertSnippet = useCallback((snippet: string) => {
    const trimmed = snippet.trim();
    if (!trimmed) return;
    ws.commit();
    const current = sourceRef.current;
    const prefix = current.trim().length === 0
      ? ''
      : current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
    setSourceRaw(`${current}${prefix}${trimmed}\n`);
    setStatus('inserted example');
  }, [ws]);

  const setTempo = useCallback((n: number) => {
    if (!Number.isFinite(n) || n <= 0) return;
    ws.commitCoalesced();
    setTempoRaw(n);
  }, [ws]);

  const setFontSize = useCallback((n: number) => {
    ws.commitCoalesced();
    setUiPrefsRaw((p) => ({ ...p, fontSize: Math.max(8, Math.min(32, n)) }));
  }, [ws]);

  const setMasterVolume = useCallback((v: number) => {
    if (!Number.isFinite(v)) return;
    // Coalesce — slider drag fires many small updates and undo of every
    // tick would be useless. One snapshot per drag-start is enough.
    ws.commitCoalesced();
    setMasterVolumeRaw(Math.max(0, Math.min(1, v)));
  }, [ws]);

  // ── Library ────────────────────────────────────────────────────────
  const addSampleFromFile = useCallback(async () => {
    setStatus('opening file picker…');
    const r = await execAsync(
      "zenity --file-selection --title='Pick a sample' " +
      "--file-filter='Audio | *.wav' " +
      "--file-filter='All files | *'"
    );
    const srcPath = (r.stdout || '').trim();
    if (!srcPath) { setStatus('no file selected'); return; }
    if (!exists(srcPath)) { setStatus(`file not found: ${srcPath}`); return; }

    const stem = ws.stem;
    // Default to the sanitized filename, then prompt the user to confirm
    // or rename. Cancelling the prompt keeps the default; a blank entry
    // also falls back to the default. The chosen id has to clear the same
    // validator as inline rename (JS identifier, no reserved/built-in
    // collision, no project-library collision).
    const baseId = sanitizeSampleId(basenameStem(srcPath));
    const existingIds = new Set(samplesRef.current.map((s) => s.id));
    let suggestedId = baseId;
    let n = 2;
    while (existingIds.has(suggestedId) || RESERVED_SANDBOX_NAMES.has(suggestedId)) {
      suggestedId = `${baseId}_${n}`; n++;
    }
    const entry = await execAsync(
      "zenity --entry --title='Name this sample' " +
      `--text='Identifier used in code (e.g. LoudKick01)' --entry-text=${shellQuote(suggestedId)}`
    );
    let id = suggestedId;
    if (entry.code === 0) {
      const raw = (entry.stdout || '').trim();
      if (raw) {
        const candidate = sanitizeSampleId(raw);
        const err = validateSampleId(candidate, RESERVED_SANDBOX_NAMES, existingIds);
        if (err) { setStatus(`add cancelled · ${err}`); return; }
        id = candidate;
      }
    }

    mkdir(samplesDirFor(stem));
    const dstPath = samplePathFor(stem, id);
    // WAV is binary; the fs hooks are UTF-8 string. Shell out to `cp` so
    // the bytes pass through untouched.
    const cp = await execAsync(`cp -- ${shellQuote(srcPath)} ${shellQuote(dstPath)}`);
    if (cp.code !== 0) {
      setStatus(`copy failed: ${(cp.stderr || '').trim() || `exit ${cp.code}`}`);
      return;
    }

    ws.commit();
    const ref: SampleRef = {
      id,
      label: basenameStem(srcPath),
      path: dstPath,
      durationMs: 0, // measured lazily on first load
      source: 'imported',
    };
    setSamples((cur) => [...cur, ref]);
    setStatus(`added sample · ${id}`);
  }, [ws]);

  const removeSample = useCallback((id: string) => {
    ws.commit();
    setSamples((cur) => cur.filter((s) => s.id !== id));
    setStatus(`removed sample · ${id}`);
  }, [ws]);

  const renameSample = useCallback((id: string, nextIdRaw: string) => {
    const nextId = sanitizeSampleId(nextIdRaw);
    if (nextId === id) return;
    const existingIds = new Set(samplesRef.current.map((s) => s.id));
    const err = validateSampleId(nextId, RESERVED_SANDBOX_NAMES, existingIds, id);
    if (err) { setStatus(`rename rejected · ${err}`); return; }
    ws.commit();
    setSamples((cur) => cur.map((s) => (s.id === id ? { ...s, id: nextId } : s)));
    setStatus(`renamed · ${id} → ${nextId}`);
  }, [ws]);

  // ── Online sample sources ──────────────────────────────────────────
  // Search a provider (Freesound first) and import a chosen result as a WAV
  // into the project library — same library surface as imported/captured
  // samples, plus provenance for attribution.
  const searchSources = useCallback(
    (source: SourceId, query: SearchQuery): Promise<SearchPage> => searchSource(source, query),
    [],
  );

  const setSourceToken = useCallback((source: SourceId, token: string) => {
    credentials.setToken(source, token);
    setStatus(`token set · ${source}`);
  }, []);

  const addSampleFromSource = useCallback(async (sample: NormalizedSample) => {
    // Allocate a code-safe id from the title, de-duping against the library
    // and reserved sandbox names — same rule as addSampleFromFile.
    const baseId = sanitizeSampleId(sample.title);
    const existingIds = new Set(samplesRef.current.map((s) => s.id));
    let id = baseId;
    let n = 2;
    while (existingIds.has(id) || RESERVED_SANDBOX_NAMES.has(id)) { id = `${baseId}_${n}`; n++; }

    const stem = ws.stem;
    mkdir(samplesDirFor(stem));
    const dstPath = samplePathFor(stem, id);
    setStatus(`downloading ${sample.title}…`);
    try {
      const result = await importSampleAsWav({
        sample,
        destPath: dstPath,
        onProgress: (p) => {
          if (p.total > 0) {
            setStatus(`downloading ${sample.title}… ${Math.round((p.bytes / p.total) * 100)}%`);
          }
        },
      });
      ws.commit();
      const ref: SampleRef = {
        id,
        label: sample.title,
        path: dstPath,
        durationMs: result.durationMs,
        source: 'fetched',
        provenance: {
          provider: sample.source,
          sourceId: sample.sourceId,
          sourceUrl: sample.sourceUrl,
          licenseFamily: sample.license.family,
          licenseUrl: sample.license.url,
          requiresAttribution: sample.license.requiresAttribution,
          authorName: sample.author.name,
          authorUrl: sample.author.profileUrl,
        },
      };
      setSamples((cur) => [...cur, ref]);
      setStatus(`added sample · ${id} (${result.sourceFormat} → wav)`);
    } catch (e) {
      setStatus(`fetch failed · ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [ws]);

  // ── Input device selection ─────────────────────────────────────────
  // Resolve the persisted device name to the current SDL id by walking
  // audioInput.devices. If the named device is gone (unplugged, etc.)
  // we silently fall back to the default — startCapture won't fail,
  // but the user can refresh + reselect if they care.
  const selectedInputDeviceId = (() => {
    if (!selectedInputDeviceName) return 0;
    const match = audioInput.devices.find((d) => d.name === selectedInputDeviceName);
    return match ? match.id : 0;
  })();
  const selectedInputDeviceIdRef = useRef(selectedInputDeviceId);
  selectedInputDeviceIdRef.current = selectedInputDeviceId;

  const setInputDevice = useCallback((device: AudioInputDevice | null) => {
    ws.commit();
    const name = device?.name ?? null;
    setSelectedInputDeviceName(name);
    setStatus(name ? `input · ${name}` : 'input · default');
  }, [ws]);

  const refreshInputDevices = useCallback(() => {
    // Refresh both lists at once — the picker pairs outputs with their
    // matching loopback inputs, so a stale output list would hide newly
    // plugged speakers/headphones from the "capture from output" section.
    audioInput.refreshDevices();
    audioInput.refreshOutputDevices();
  }, [audioInput]);

  // ── Mic capture ────────────────────────────────────────────────────
  // Routes through framework/audio_input (raw 44.1kHz mono, no VAD).
  // start() opens the device (default or selected); stop() writes a WAV
  // under the project's samples dir and registers a new SampleRef.
  // Same library surface as imported samples, just with source='captured'.
  const startCapture = useCallback(() => {
    const ok = audioInput.start(selectedInputDeviceIdRef.current);
    if (!ok) { setStatus('mic device unavailable'); return; }
    const which = selectedInputDeviceName ?? 'default device';
    setStatus(`recording from ${which}…`);
  }, [audioInput, selectedInputDeviceName]);

  const stopCapture = useCallback(() => {
    if (!audioInput.isRecording) return;
    const stem = ws.stem;
    const ts = Date.now();
    const id = `captured_${ts.toString(36)}`;
    mkdir(samplesDirFor(stem));
    const dstPath = samplePathFor(stem, id);
    const ok = audioInput.stop(dstPath);
    if (!ok) { setStatus('capture write failed'); return; }
    ws.commit();
    const ref: SampleRef = {
      id,
      label: `Capture · ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
      path: dstPath,
      durationMs: 0,
      source: 'captured',
      capturedAt: ts,
    };
    setSamples((cur) => [...cur, ref]);
    const cappedNote = audioInput.wasCapped ? ' (capped at 10 min)' : '';
    setStatus(`captured · ${id}${cappedNote}`);
  }, [audioInput, ws]);

  // ── Compile + transport ────────────────────────────────────────────
  const compile = useCallback(() => {
    ws.commit();
    const result = compileAndRun(sourceRef.current, { audio, samples: samplesRef.current });
    setLastCompile(result);
    if (result.ok) {
      setIsPlaying(true);
      setStatus(`compiled · ${result.bindings.length} bindings · playing`);
    } else {
      setIsPlaying(false);
      setStatus(`compile error · ${result.error}`);
    }
  }, [audio, ws]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      setStatus('paused');
    } else {
      audio.play();
      setIsPlaying(true);
      setStatus('playing');
    }
  }, [audio, isPlaying]);

  const stop = useCallback(() => {
    audio.stop();
    setIsPlaying(false);
    setStatus('stopped');
  }, [audio]);

  // ── Keyboard ───────────────────────────────────────────────────────
  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z come free from useWorkspace.
  // Ctrl+S is the cart-specific compile-and-play shortcut.
  // '?' toggles the cheat sheet (only when nothing has captured focus —
  // useIFTTT respects the global key bus, so typing '?' inside a
  // TextInput won't also pop the cheat sheet because the input swallows
  // the keystroke before the global handler sees it).
  useIFTTT('key:ctrl+s', () => compile());
  useIFTTT('key:?', () => toggleCheatSheet());

  return {
    stem: ws.stem,
    setStem: ws.setStem,
    lastSavedAt: ws.lastSavedAt,
    restoredFrom: ws.restoredFrom,
    canUndo: ws.canUndo,
    canRedo: ws.canRedo,
    undo: ws.undo,
    redo: ws.redo,
    source,
    setSource,
    insertSnippet,
    samples,
    addSampleFromFile,
    removeSample,
    renameSample,
    availableSources: availableSources(),
    searchSources,
    addSampleFromSource,
    setSourceToken,
    isCapturing: audioInput.isRecording,
    captureLevel: audioInput.level,
    startCapture,
    stopCapture,
    inputDevices: audioInput.devices,
    refreshInputDevices,
    outputDevices: audioInput.outputDevices,
    selectedInputDeviceName,
    selectedInputDeviceId,
    setInputDevice,
    tempo,
    setTempo,
    masterVolume,
    setMasterVolume,
    isPlaying,
    togglePlay,
    stop,
    compile,
    lastCompile,
    uiPrefs,
    setFontSize,
    isCheatSheetOpen,
    openCheatSheet,
    closeCheatSheet,
    toggleCheatSheet,
    status,
  };
}

/** Single-quote a shell argument, escaping any internal single quotes
 *  via the POSIX 'closing-quote, escaped-quote, reopening-quote' trick.
 *  Safe to interpolate into a `sh -c`-style command line. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
