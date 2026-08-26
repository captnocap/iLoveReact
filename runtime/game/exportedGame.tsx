import { createElement, useEffect, useRef, useState } from 'react';
import { exists, readFile } from '../hooks/fs';
import {
  WORLD_AUDIO_PLAYER_ENTITY_ID,
  attachWorldAudioEmitter,
  detachWorldAudioEmitter,
  triggerWorldAudioEmitter,
  tuneWorldAudioEmitter,
} from '../audio';
import {
  decibelsToUnitGain,
  fartRacerEngineMix,
  parseFartRacerAudioManifest,
  type FartRacerAudioManifest,
} from './fartRacerAudio';

type FartRacerTelemetry = Readonly<{
  version: 1;
  game: 'fart-racer';
  phase: 'running' | 'won' | 'soiled' | 'wrecked';
  tankLiters: number;
  tankCapacityLiters: number;
  bowelPressure: number;
  bowelCapacity: number;
  durability: number;
  durabilityCapacity: number;
  nextCheckpoint: number;
  checkpointCount: number;
  elapsedSeconds: number;
  speedMetersPerSecond: number;
  boost: number;
  digestionCount: number;
  worldId: number;
  rpmNormalized: number;
  eatEvents: number;
  speakerEvents: number;
  tankFillEvents: number;
  collisionEvents: number;
  skidEvents: number;
}>;

function readFartRacerTelemetry(): FartRacerTelemetry | null {
  const host = globalThis as typeof globalThis & { __compiled_world_game_telemetry?: () => unknown };
  if (typeof host.__compiled_world_game_telemetry !== 'function') return null;
  try {
    const parsed = JSON.parse(String(host.__compiled_world_game_telemetry())) as FartRacerTelemetry;
    return parsed?.version === 1 && parsed.game === 'fart-racer' ? parsed : null;
  } catch {
    return null;
  }
}

function meter(label: string, value: number, capacity: number, color: string) {
  const fraction = capacity > 0 ? Math.max(0, Math.min(1, value / capacity)) : 0;
  return createElement('Box', { style: { gap: 3 } },
    createElement('Box', { style: { flexDirection: 'row', justifyContent: 'space-between' } },
      createElement('Text', { style: { color: '#d9e5dc', fontSize: 11, fontWeight: '700' } }, label),
      createElement('Text', { style: { color: '#aebbb1', fontSize: 10, fontFamily: 'monospace' } }, `${value.toFixed(1)} / ${capacity.toFixed(1)}`)),
    createElement('Box', { style: { width: 220, height: 8, backgroundColor: '#1b2921', borderRadius: 4, overflow: 'hidden' } },
      createElement('Box', { style: { width: `${fraction * 100}%`, height: 8, backgroundColor: color, borderRadius: 4 } })),
  );
}

function FartRacerHud({ telemetry }: { telemetry: FartRacerTelemetry | null }) {
  if (!telemetry) return null;
  const outcome = telemetry.phase === 'won'
    ? 'FINISH — YOU WON'
    : telemetry.phase === 'soiled'
      ? 'SOILED — BOWEL PRESSURE MAXED'
      : telemetry.phase === 'wrecked'
        ? 'WRECKED — DURABILITY LOST'
        : null;
  return createElement('Box', { testID: 'fart-racer-hud', style: { position: 'absolute', left: 18, top: 18, gap: 7, padding: 12, backgroundColor: 'rgba(7,14,10,0.88)', borderWidth: 1, borderColor: '#46614f', borderRadius: 8 } },
    createElement('Text', { style: { color: '#f0f5e8', fontSize: 15, fontWeight: '800' } }, 'FART RACER'),
    meter('NATURAL GAS · L', telemetry.tankLiters, telemetry.tankCapacityLiters, '#69c786'),
    meter('BOWEL PRESSURE', telemetry.bowelPressure, telemetry.bowelCapacity, '#e4b35d'),
    meter('DURABILITY', telemetry.durability, telemetry.durabilityCapacity, '#e06b62'),
    createElement('Text', { style: { color: '#cad8ce', fontSize: 11, fontFamily: 'monospace' } }, `CHECKPOINT ${Math.min(telemetry.nextCheckpoint, telemetry.checkpointCount)} / ${telemetry.checkpointCount}   ${telemetry.speedMetersPerSecond.toFixed(1)} m/s   ${telemetry.elapsedSeconds.toFixed(1)} s`),
    createElement('Text', {
      style: { color: (telemetry.boost ?? 0) > 0.01 ? '#f2d46a' : '#8fa499', fontSize: 11, fontWeight: (telemetry.boost ?? 0) > 0.01 ? '800' : '400' },
    }, (telemetry.boost ?? 0) > 0.01 ? 'E — LETTING IT RIP' : 'E — hold to rip (burns gas)'),
    createElement('Text', { style: { color: '#8fa499', fontSize: 10 } }, `W/S throttle + brake · A/D steer · Space handbrake · Shift foot brake${telemetry.digestionCount ? ` · digesting ${telemetry.digestionCount}` : ''}`),
    outcome ? createElement('Text', { style: { color: telemetry.phase === 'won' ? '#8be3a6' : '#ff8175', fontSize: 14, fontWeight: '900' } }, outcome) : null,
  );
}

type FartRacerAudioSession = Readonly<{
  worldId: number;
  engineEmitters: readonly number[];
  eventEmitters: Readonly<Record<string, number>>;
  attachedEmitters: readonly number[];
  counters: Record<string, number>;
}>;

const EVENT_COUNTER_ENTRIES = Object.freeze([
  ['vehicle.skid', 'skidEvents'],
  ['impact.body', 'collisionEvents'],
  ['vehicle.tankFill', 'tankFillEvents'],
  ['item.eat', 'eatEvents'],
  ['driveThru.speaker', 'speakerEvents'],
] as const satisfies readonly (readonly [string, keyof FartRacerTelemetry])[]);

function FartRacerRuntime({ audioManifestPath }: { audioManifestPath?: string }) {
  const [telemetry, setTelemetry] = useState<FartRacerTelemetry | null>(null);
  const [audioManifest] = useState<FartRacerAudioManifest | null>(() =>
    parseFartRacerAudioManifest(audioManifestPath ? readFile(audioManifestPath) : null));
  const audioSession = useRef<FartRacerAudioSession | null>(null);

  useEffect(() => {
    const refresh = () => setTelemetry(readFartRacerTelemetry());
    refresh();
    const timer = setInterval(refresh, 100);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!telemetry || !audioManifest || telemetry.worldId <= 0) return;
    const worldId = telemetry.worldId;
    const engine = audioManifest.events['vehicle.engine']!;
    const initialMix = fartRacerEngineMix(engine, telemetry.rpmNormalized);
    const attachedEmitters: number[] = [];
    const engineEmitters: number[] = [];
    const eventEmitters: Record<string, number> = {};
    let nextEmitterId = 1;
    let nextTrack = 0;
    const attach = (tag: string, clipPath: string, playback: 'oneShot' | 'loop', gain: number, clipIndex = 0) => {
      const row = audioManifest.events[tag]!;
      const emitterId = nextEmitterId++;
      const staticSpeaker = tag === 'driveThru.speaker' && row.position;
      const ok = attachWorldAudioEmitter({
        worldId,
        emitterId,
        entityId: staticSpeaker ? 2 : WORLD_AUDIO_PLAYER_ENTITY_ID,
        track: nextTrack++,
        playback,
        clipPath,
        position: staticSpeaker ?? { x: 0, y: 0, z: 0 },
        gain,
      });
      if (!ok) return false;
      attachedEmitters.push(emitterId);
      if (tag === 'vehicle.engine') engineEmitters[clipIndex] = emitterId;
      else eventEmitters[tag] = emitterId;
      return true;
    };
    let complete = true;
    engine.clips.forEach((clip, index) => {
      complete = attach('vehicle.engine', clip, 'loop', initialMix.gains[index] ?? 0, index) && complete;
    });
    for (const [tag] of EVENT_COUNTER_ENTRIES) {
      const row = audioManifest.events[tag]!;
      complete = attach(tag, row.clips[0]!, 'oneShot', decibelsToUnitGain(row.gainDb)) && complete;
    }
    if (!complete) {
      attachedEmitters.forEach((emitterId) => detachWorldAudioEmitter(worldId, emitterId));
      return;
    }
    const counters: Record<string, number> = {};
    for (const [tag, key] of EVENT_COUNTER_ENTRIES) counters[tag] = telemetry[key] as number;
    audioSession.current = { worldId, engineEmitters, eventEmitters, attachedEmitters, counters };
    engineEmitters.forEach((emitterId, index) =>
      tuneWorldAudioEmitter(worldId, emitterId, initialMix.gains[index] ?? 0, initialMix.playbackRate));
    return () => {
      if (audioSession.current?.worldId === worldId) audioSession.current = null;
      attachedEmitters.forEach((emitterId) => detachWorldAudioEmitter(worldId, emitterId));
    };
  }, [audioManifest, telemetry?.worldId]);

  useEffect(() => {
    const session = audioSession.current;
    if (!telemetry || !audioManifest || !session || session.worldId !== telemetry.worldId) return;
    const mix = fartRacerEngineMix(audioManifest.events['vehicle.engine']!, telemetry.rpmNormalized);
    session.engineEmitters.forEach((emitterId, index) =>
      tuneWorldAudioEmitter(session.worldId, emitterId, mix.gains[index] ?? 0, mix.playbackRate));
    for (const [tag, key] of EVENT_COUNTER_ENTRIES) {
      const current = telemetry[key] as number;
      if (current > (session.counters[tag] ?? 0)) triggerWorldAudioEmitter(session.worldId, session.eventEmitters[tag]!);
      session.counters[tag] = current;
    }
  }, [audioManifest, telemetry]);

  return createElement(FartRacerHud, { telemetry });
}

export function ExportedGame({ gameFile, storeDir, gameId, audioManifest }: { gameFile: string; storeDir: string; gameId: string; audioManifest?: string }) {
  if (!exists(gameFile)) {
    return createElement('Box', {
      testID: `exported-game-missing-data:${gameId}`,
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#09100d' },
    }, createElement('Box', {
      style: { maxWidth: 620, gap: 8, padding: 18, borderWidth: 1, borderColor: '#9a4e45', borderRadius: 8, backgroundColor: '#241311' },
    },
    createElement('Text', { style: { color: '#ff9386', fontSize: 16, fontWeight: '900' } }, 'EXPORTED GAME DATA NOT FOUND'),
    createElement('Text', { style: { color: '#e0b6ae', fontSize: 11, fontFamily: 'monospace' } }, `Missing ${gameFile}`),
    createElement('Text', { style: { color: '#b99c96', fontSize: 10 } }, 'Run the editor-exported artifact from zig-out/game, or export the game again.')));
  }
  return createElement('Box', {
    testID: `exported-game:${gameId}`,
    style: { position: 'absolute', inset: 0, width: '100%', height: '100%', backgroundColor: '#09100d' },
  }, createElement('WorldLoader', {
    gameFile,
    storeDir,
    testID: `exported-world:${gameId}`,
    style: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  }), gameId === 'fart-racer' ? createElement(FartRacerRuntime, { audioManifestPath: audioManifest }) : null);
}
