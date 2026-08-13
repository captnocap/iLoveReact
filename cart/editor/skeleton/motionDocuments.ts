// Motion documents in the editor (req_4285): the authoring-side face of the
// RJAN store and the mixer doors.
//
// React declares data — keys as name→quaternion maps at declared times — and
// every format/mixer operation stays native: __compiled_world_motion_document
// encodes/decodes, __compiled_world_play_motion mounts a layer,
// __compiled_world_scrub_motion parks the playhead. No RJAN byte or slerp is
// ever hand-rolled here.

import { editorDataPath, ensureEditorDataDir } from '../data/editorDataRoot';

const g: any = globalThis;

export type MotionEasing = 'slerp' | 'smooth' | 'hold';
export type MotionQuat = [number, number, number, number];
export type MotionVec3 = [number, number, number];

export type MotionKeyJson = {
  timeSeconds: number;
  easing?: MotionEasing;
  root?: MotionVec3;
  planted?: string[];
  channels: Record<string, MotionQuat>;
};

export type MotionRunJson = {
  startSeconds: number;
  channels: string[];
  times: number[];
  roots?: MotionVec3[];
  deltas: MotionQuat[];
};

export type MotionDocumentJson = {
  name: string;
  looping: boolean;
  durationSeconds: number;
  source?: 'hand' | 'capture' | 'clip_migration';
  channels: string[];
  keys: MotionKeyJson[];
  runs?: MotionRunJson[];
};

export type MotionPlayReceipt = {
  playing: boolean;
  name?: string;
  durationSeconds?: number;
  looping?: boolean;
  channelCount?: number;
};

/** The driven role wire vocabulary — the channels capture records and the
 * superset of what the built-in clips speak. New hand documents default to
 * this full set; partial keys narrow per pose. */
export const MOTION_ROLE_CHANNELS: readonly string[] = [
  'pelvis', 'spine_lower', 'spine_upper', 'neck', 'head',
  'clavicle_left', 'upper_arm_left', 'lower_arm_left',
  'clavicle_right', 'upper_arm_right', 'lower_arm_right',
  'upper_leg_left', 'lower_leg_left', 'upper_leg_right', 'lower_leg_right',
];

export class MotionDocumentFault extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotionDocumentFault';
  }
}

/** The editor's motion library home, a sibling of every other authored
 * editor data family (never under zig-out). */
export const MOTION_LIBRARY_DIR = editorDataPath('motion');

export function ensureMotionLibraryDir(): void {
  ensureEditorDataDir('motion');
}

export function motionLibraryPath(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'motion';
  return `${MOTION_LIBRARY_DIR}/${slug}.rjan`;
}

function parseDoorReply<T>(raw: unknown, door: string): T {
  if (typeof raw === 'string' && raw.startsWith('error:')) {
    throw new MotionDocumentFault(`${door}: ${raw.slice('error:'.length)}`);
  }
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || (parsed as { ok?: unknown }).ok !== true) {
    throw new MotionDocumentFault(`${door} returned a malformed reply`);
  }
  return parsed as T;
}

export function motionDoorsAvailable(): boolean {
  return typeof g.__compiled_world_play_motion === 'function' &&
    typeof g.__compiled_world_scrub_motion === 'function' &&
    typeof g.__compiled_world_motion_document === 'function';
}

/** Mount a document from disk on one mixer layer of a mounted world player. */
export function playMotion(nodeId: number, path: string, layer = 0): MotionPlayReceipt {
  return parseDoorReply<MotionPlayReceipt>(
    g.__compiled_world_play_motion?.(nodeId, path, layer),
    '__compiled_world_play_motion',
  );
}

/** Stop one layer; whatever plays underneath resumes through the fade. */
export function stopMotion(nodeId: number, layer = 0): void {
  parseDoorReply<unknown>(g.__compiled_world_play_motion?.(nodeId, '', layer), '__compiled_world_play_motion');
}

/** Park a layer's playhead at an exact time (the workbench scrub). */
export function scrubMotion(nodeId: number, layer: number, seconds: number): void {
  parseDoorReply<unknown>(g.__compiled_world_scrub_motion?.(nodeId, layer, seconds), '__compiled_world_scrub_motion');
}

/** Release a scrubbed layer back into playback. */
export function resumeMotion(nodeId: number, layer: number): void {
  parseDoorReply<unknown>(g.__compiled_world_scrub_motion?.(nodeId, layer, -1), '__compiled_world_scrub_motion');
}

export function saveMotionDocument(path: string, document: MotionDocumentJson): { path: string; bytes: number } {
  const reply = parseDoorReply<{ path: string; bytes: number }>(
    g.__compiled_world_motion_document?.(JSON.stringify({ op: 'save', path, document })),
    '__compiled_world_motion_document',
  );
  return reply;
}

export function loadMotionDocument(path: string): MotionDocumentJson {
  const reply = parseDoorReply<{ document: MotionDocumentJson }>(
    g.__compiled_world_motion_document?.(JSON.stringify({ op: 'load', path })),
    '__compiled_world_motion_document',
  );
  return reply.document;
}

// ── pure timeline edits ───────────────────────────────────────────────────────
// Keys are just times over role channels: sliding one around re-declares WHEN,
// never HOW, and the store re-fills the in-betweens on the next sample.

function sortedKeys(keys: MotionKeyJson[]): MotionKeyJson[] {
  return [...keys].sort((a, b) => a.timeSeconds - b.timeSeconds);
}

export function retimeKey(document: MotionDocumentJson, keyIndex: number, timeSeconds: number): MotionDocumentJson {
  const keys = document.keys.map((key, index) => index === keyIndex
    ? { ...key, timeSeconds: Math.min(Math.max(timeSeconds, 0), document.durationSeconds) }
    : key);
  return { ...document, keys: sortedKeys(keys) };
}

export function addKey(document: MotionDocumentJson, key: MotionKeyJson): MotionDocumentJson {
  const known = new Set(document.channels);
  const filtered: Record<string, MotionQuat> = {};
  for (const [channel, delta] of Object.entries(key.channels)) {
    if (known.has(channel)) filtered[channel] = delta;
  }
  if (Object.keys(filtered).length === 0) {
    throw new MotionDocumentFault('key covers no channel this document speaks');
  }
  const next = { ...key, channels: filtered, timeSeconds: Math.min(Math.max(key.timeSeconds, 0), document.durationSeconds) };
  return { ...document, keys: sortedKeys([...document.keys, next]) };
}

export function removeKey(document: MotionDocumentJson, keyIndex: number): MotionDocumentJson {
  return { ...document, keys: document.keys.filter((_, index) => index !== keyIndex) };
}

/** A fresh hand document over the given role channels. */
export function newMotionDocument(name: string, channels: string[], durationSeconds = 2, looping = true): MotionDocumentJson {
  return { name, looping, durationSeconds, source: 'hand', channels, keys: [] };
}

// ── the /play world registry ─────────────────────────────────────────────────
// The playtest surface registers its mounted WorldLoader node so the
// workbench's PLAY button can put a document on the actual embodied player.

let playWorldNodeId = 0;

export function registerPlayWorldNode(nodeId: number): void {
  playWorldNodeId = Number.isInteger(nodeId) && nodeId > 0 ? nodeId : 0;
}

export function unregisterPlayWorldNode(nodeId: number): void {
  if (playWorldNodeId === nodeId) playWorldNodeId = 0;
}

export function currentPlayWorldNode(): number {
  return playWorldNodeId;
}
