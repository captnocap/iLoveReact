// editor/data/sessionStore.ts — the durable WORKING SESSION (req_4435).
//
//   userdata/editor/session.json
//
// What was already durable across a cold start: the map document pointer
// (maps/_last.txt), each map's own files, the color library, lab recipes and
// the Asset Explorer's Recent. What was NOT: which documents you had open,
// which one you were looking at, which panes, which folder, which material,
// which storey, where the camera stood. All of that lived only in the
// `editor:view:v2` hot twig (persistView.ts) — Zig-owned memory that survives a
// hot reload and, by design, nothing else. So every real restart reopened an
// arbitrary map with nothing restored and no way back to yesterday's work.
//
// This is the missing per-concern save, written the same way as its siblings
// (libraryHistoryStore.ts is the template): one versioned file, atomic write,
// debounced, malformed input reported and ignored so startup stays available.
//
// It is a RESUME RECORD, never a second world store. Placed pieces, terrain and
// zones belong to the named map document and are read from there; this file
// only remembers WHERE YOU WERE, so `Continue` can put you back.
import { mkdir, readFile, writeFile, writeFileBytesAtomic } from '../../../runtime/hooks/fs';
import { getHotState, setHotState } from '../../../runtime/hooks/useHotState';
import { EDITOR_DATA_ROOT } from './editorDataRoot';
import { textBytes } from '../../../runtime/workspace/lumps';
import type { WorkspaceDocument, WorkspaceDocumentKind } from './types';
import type { WorldViewPose } from '../world/worldViews';

export const SESSION_FILE = `${EDITOR_DATA_ROOT}/session.json`;
const SESSION_VERSION = 1;

/** How many reopened tabs a resume is allowed to carry. Past this the record is
 *  a junk drawer rather than a place you were. */
export const SESSION_MAX_DOCUMENTS = 12;

/** One reopenable tab. Only identity is stored — titles are re-derived from the
 *  live model/material on restore, because a stored title goes stale the moment
 *  the thing is renamed (the same law StageTabs already follows). */
export type SessionDocument = {
  id: string;
  kind: WorkspaceDocumentKind;
  sourceId?: string;
};

export type EditorSession = {
  version: 1;
  /** Wall-clock of the last write — the resume surface's "last worked on". */
  savedMs: number;
  /** How many times the editor has been cold-started. Home rotates its lines
   *  off this and throws confetti on the round numbers. */
  launch: number;
  /** The map document this session was working in, by stable directory stem. */
  mapStem: string;
  /** Its friendly title at save time, so the resume card can name it without
   *  reading every map's metadata first. */
  mapName: string;
  documents: SessionDocument[];
  activeDocumentId: string;
  /** Panels/benches — where the workspace was arranged. */
  rightPane: string;
  rightPanelCollapsed: boolean;
  activeDomain: string;
  leftPanelCollapsed: boolean;
  libraryExpanded: boolean;
  contentFolder: string;
  activeCommandId: string;
  /** The user's selections — null when they genuinely had nothing selected. A
   *  restore must be able to reproduce "nothing selected" faithfully. */
  activeAssetId: string | null;
  selectedPieceId: string | null;
  /** Active storey and the exact camera stance, captured through the same pose
   *  shape the saved-views system uses so restore replays its recall path. */
  floorIndex: number;
  camera: WorldViewPose | null;
};

function finiteInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const DOCUMENT_KINDS: readonly WorkspaceDocumentKind[] = [
  'world', 'model', 'material', 'facade', 'playtest', 'animation', 'knowledge', 'home',
];

function parseDocuments(raw: unknown): SessionDocument[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SessionDocument[] = [];
  for (const entry of raw) {
    const id = optionalId((entry as SessionDocument)?.id);
    const kind = (entry as SessionDocument)?.kind;
    if (!id || seen.has(id)) continue;
    if (!DOCUMENT_KINDS.includes(kind)) continue;
    seen.add(id);
    const sourceId = optionalId((entry as SessionDocument).sourceId);
    out.push(sourceId ? { id, kind, sourceId } : { id, kind });
    if (out.length >= SESSION_MAX_DOCUMENTS) break;
  }
  return out;
}

function parseCamera(raw: unknown): WorldViewPose | null {
  const pose = raw as Partial<WorldViewPose> | null | undefined;
  if (!pose || typeof pose !== 'object') return null;
  const numbers = [pose.centerX, pose.centerZ, pose.yaw, pose.pitch, pose.zoom, pose.floor];
  if (numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  return {
    centerX: pose.centerX!,
    centerZ: pose.centerZ!,
    yaw: pose.yaw!,
    pitch: pose.pitch!,
    zoom: pose.zoom!,
    floor: Math.max(0, Math.trunc(pose.floor!)),
  };
}

export function parseSessionText(text: string): EditorSession {
  const raw = JSON.parse(text) as Partial<EditorSession>;
  if (raw.version !== SESSION_VERSION) throw new Error(`unrecognized shape (version ${raw.version})`);
  const mapStem = optionalId(raw.mapStem);
  if (!mapStem) throw new Error('mapStem is required — a session without its map cannot be resumed');
  const documents = parseDocuments(raw.documents);
  const activeDocumentId = optionalId(raw.activeDocumentId);
  return {
    version: SESSION_VERSION,
    savedMs: finiteInt(raw.savedMs),
    launch: Math.max(0, finiteInt(raw.launch)),
    mapStem,
    mapName: typeof raw.mapName === 'string' && raw.mapName ? raw.mapName : mapStem,
    documents,
    // An active id that names no reopened tab would restore to a blank stage.
    activeDocumentId: activeDocumentId && documents.some((doc) => doc.id === activeDocumentId)
      ? activeDocumentId
      : documents[0]?.id ?? '',
    rightPane: typeof raw.rightPane === 'string' ? raw.rightPane : 'inspector',
    rightPanelCollapsed: raw.rightPanelCollapsed === true,
    activeDomain: typeof raw.activeDomain === 'string' ? raw.activeDomain : 'assets',
    leftPanelCollapsed: raw.leftPanelCollapsed === true,
    libraryExpanded: raw.libraryExpanded === true,
    contentFolder: typeof raw.contentFolder === 'string' ? raw.contentFolder : '',
    activeCommandId: typeof raw.activeCommandId === 'string' ? raw.activeCommandId : 'select-tool',
    activeAssetId: optionalId(raw.activeAssetId),
    selectedPieceId: optionalId(raw.selectedPieceId),
    floorIndex: Math.max(0, finiteInt(raw.floorIndex)),
    camera: parseCamera(raw.camera),
  };
}

/** Null means first run or an unreadable save. A malformed session is reported
 *  and ignored — it must never be able to keep the editor from starting. */
export function loadSession(): EditorSession | null {
  const text = readFile(SESSION_FILE);
  if (!text) return null;
  try {
    return parseSessionText(text);
  } catch (error) {
    console.error(`[editor-session] ${SESSION_FILE} is malformed — booting without a resume: ${error}`);
    return null;
  }
}

/** Reduce the live workspace tabs to the reopenable identities. The Home tab is
 *  never recorded: Home is where a boot STARTS, so storing it would make a
 *  resume reopen the thing you resumed from. */
export function sessionDocumentsFrom(documents: readonly WorkspaceDocument[]): SessionDocument[] {
  return documents
    .filter((doc) => doc.kind !== 'home')
    .slice(0, SESSION_MAX_DOCUMENTS)
    .map((doc) => (doc.sourceId ? { id: doc.id, kind: doc.kind, sourceId: doc.sourceId } : { id: doc.id, kind: doc.kind }));
}

let dirReady = false;

function writeSave(session: EditorSession): boolean {
  if (!dirReady) {
    mkdir(EDITOR_DATA_ROOT);
    dirReady = true;
  }
  const text = JSON.stringify(session);
  const ok = writeFileBytesAtomic(SESSION_FILE, textBytes(text)) || writeFile(SESSION_FILE, text);
  if (!ok) console.error(`[editor-session] SAVE FAILED: ${SESSION_FILE} — this session will not be resumable`);
  return ok;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queued: EditorSession | null = null;

function writeQueued(): void {
  saveTimer = null;
  const session = queued;
  queued = null;
  if (session) writeSave(session);
}

/** Debounced micro-save, on the same contract as the color library and library
 *  history: the shell calls it whenever the working session changes. */
export function scheduleSessionSave(session: EditorSession, delayMs = 600): void {
  queued = session;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeQueued, Math.max(0, delayMs));
}

/** Flush any pending write immediately — used before the app tears down, so the
 *  last few seconds of arrangement are not the ones you lose. */
export function flushSessionSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    writeQueued();
  }
}

// ── Launch number ──────────────────────────────────────────────────────────
//
// "How many times have I come back to this?" — the number Home rotates its
// lines off and celebrates the round values of. It must count COLD STARTS, so
// it is parked in a hot twig: a dev hot reload finds the twig already set and
// reuses the number, while a real process start finds it empty and takes the
// next one off the session file. Same mechanism the rest of the editor uses to
// tell a reload apart from a restart (persistView.ts).
const LAUNCH_HOT_KEY = 'editor:launch:v1';

export function bootLaunchNumber(previous: EditorSession | null): number {
  const held = getHotState<number>(LAUNCH_HOT_KEY, 0);
  if (held > 0) return held;
  const next = Math.max(0, previous?.launch ?? 0) + 1;
  setHotState<number>(LAUNCH_HOT_KEY, next);
  return next;
}
