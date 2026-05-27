// Cockpit — ported from tsz/carts/cockpit/cockpit.app.tsz.
//
// Shape: SegmentsRow header / Canvas workspace with worker ChatFrame nodes /
// Canvas.Clamp overlay with Raid + Quest columns and a 6-slot action bar +
// term input / BottomBar with theme switch.
//
// FFI note: the tsz version drives conversations via __claude_init/_send/_poll,
// __kimi_*, __localai_*, __getenv, __setInputText, __pollInputSubmit, useIFTTT.
// Those host globals don't exist on the root qjs stack yet — the cockpit renders
// fine without them; sends just surface a "backend not wired" system message.

import { useState, useEffect, useRef } from 'react';
import { Box, Canvas, TextInput } from '@reactjit/runtime/primitives';
import { ThemeProvider } from '@reactjit/runtime/theme';
import './style.cls';
import { C } from './style.cls';
import { THEMES, THEME_NAMES } from './themes';
import { ChatFrame } from './ChatFrame';
import { RaidFrame, RaidFrameEmpty } from './RaidFrame';
import { QuestCard } from './QuestLog';

// ── FFI stubs ───────────────────────────────────────────────────────────
const host: any = globalThis as any;
const getenv        = typeof host.__getenv        === 'function' ? host.__getenv        : (_: string) => '';
const claude_init   = typeof host.__claude_init   === 'function' ? host.__claude_init   : (_a: string, _b: string, _c?: string) => 0;
const claude_close  = typeof host.__claude_close  === 'function' ? host.__claude_close  : () => {};
const claude_send   = typeof host.__claude_send   === 'function' ? host.__claude_send   : (_: string) => 0;
const claude_poll   = typeof host.__claude_poll   === 'function' ? host.__claude_poll   : () => null;
const kimi_init     = typeof host.__kimi_init     === 'function' ? host.__kimi_init     : (_a: string, _b: string, _c?: string) => 0;
const kimi_close    = typeof host.__kimi_close    === 'function' ? host.__kimi_close    : () => {};
const kimi_send     = typeof host.__kimi_send     === 'function' ? host.__kimi_send     : (_: string) => 0;
const kimi_poll     = typeof host.__kimi_poll     === 'function' ? host.__kimi_poll     : () => null;
const localai_init  = typeof host.__localai_init  === 'function' ? host.__localai_init  : (_a: string, _b: string, _c?: string) => 0;
const localai_close = typeof host.__localai_close === 'function' ? host.__localai_close : () => {};
const localai_send  = typeof host.__localai_send  === 'function' ? host.__localai_send  : (_: string) => 0;
const localai_poll  = typeof host.__localai_poll  === 'function' ? host.__localai_poll  : () => null;

// ── Helpers ─────────────────────────────────────────────────────────────
const MAX_MSGS = 20;
const CARD_X = 24;
const CARD_Y = 24;
const CARD_W = 500;
const CARD_H = 460;
const QUEST_ATTACH_H = 176;
const QUEST_ATTACH_GAP = 8;
const CARD_GAP_X = 56;
const CARD_GAP_Y = 56;
const WORKER_COLS = 2;

const COMMAND_HELP = 'commands: /use <claude|kimi|local> <model> | /backend <claude|kimi|local> | /model <model> | /connect | /disconnect | /status | /help';

type WorkerState = {
  id: string;
  label: string;
  gx: number;
  gy: number;
  gw: number;
  gh: number;
  initState: number;
  selectedBackend: string;
  selectedModel: string;
  activeBackend: string;
  activeModel: string;
  sessionId: string;
  claudeSessionId: string;
  claudeSessionModel: string;
  kimiSessionId: string;
  kimiSessionModel: string;
  localSessionId: string;
  localSessionModel: string;
  turnCount: number;
  turnText: string;
  totalCost: number;
  costText: string;
  isStreaming: number;
  isConnecting: boolean;
  spawnMenuOpen: boolean;
  selectedVariant: string;
  selectedEffort: string;
  selectedContext: string;
  msgCount: number;
  kinds: string[];
  texts: string[];
  activeContentKind: string;
  turnHasAssistantText: boolean;
  quest: WorkerQuest | null;
};

type WorkerQuestStepStatus = 'pending' | 'active' | 'completed' | 'rejected';

type WorkerQuestStep = {
  id: string;
  text: string;
  status: WorkerQuestStepStatus;
};

type WorkerQuest = {
  title: string;
  steps: WorkerQuestStep[];
};

type VariantConfig = {
  backend: string;
  model: string;
};

const VARIANT_MAP: Record<string, VariantConfig> = {
  'opus-4-7':          { backend: 'claude', model: 'claude-opus-4-7' },
  'opus-4-7-1m':       { backend: 'claude', model: 'claude-opus-4-7' },
  'opus-4-6':          { backend: 'claude', model: 'claude-opus-4-6' },
  'sonnet-4-6':        { backend: 'claude', model: 'claude-sonnet-4-6' },
  'sonnet-4-5':        { backend: 'claude', model: 'claude-sonnet-4-5' },
  'haiku-4-5':         { backend: 'claude', model: 'claude-haiku-4-5' },
  'kimi-coding':       { backend: 'kimi',   model: 'kimi-code/kimi-for-coding' },
  'codex':             { backend: 'local',  model: 'codex' },
  'gpt-5-4':           { backend: 'local',  model: 'gpt-5.4' },
  'gpt-5-4-mini':      { backend: 'local',  model: 'gpt-5.4-mini' },
  'gemini-pro':        { backend: 'local',  model: 'gemini-2.5-pro' },
  'gemini-flash':      { backend: 'local',  model: 'gemini-2.5-flash' },
  'gemini-flash-lite': { backend: 'local',  model: 'gemini-2.5-flash-lite' },
};

function trimText(text: string): string { return (text || '').trim(); }
function compactText(text: string, maxLen: number): string {
  const clean = trimText(text).replace(/\s+/g, ' ');
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, Math.max(0, maxLen - 1)) + '…';
}
function titleFromPrompt(text: string): string {
  const clean = compactText(text, 36).replace(/[.?!]+$/, '');
  if (!clean) return 'Resolve worker task';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
function buildQuestFromPrompt(prompt: string): WorkerQuest {
  return {
    title: titleFromPrompt(prompt),
    steps: [
      { id: 'scope', text: 'Capture request and lock task scope', status: 'completed' },
      { id: 'inspect', text: 'Inspect current files and runtime behavior', status: 'active' },
      { id: 'implement', text: 'Apply the worker-side patch', status: 'pending' },
      { id: 'verify', text: 'Verify result and edge cases', status: 'pending' },
      { id: 'resolve', text: 'Mark the task as resolved', status: 'pending' },
    ],
  };
}
function advanceQuest(quest: WorkerQuest | null, stage: 'tool' | 'assistant'): WorkerQuest | null {
  if (!quest) return quest;
  const steps = quest.steps.map((step) => ({ ...step }));
  const activeIdx = steps.findIndex((step) => step.status === 'active');
  if (stage === 'tool' && activeIdx === 1) {
    steps[1].status = 'completed';
    if (steps[2]) steps[2].status = 'active';
    return { ...quest, steps };
  }
  if (stage === 'assistant' && activeIdx === 2) {
    steps[2].status = 'completed';
    if (steps[3]) steps[3].status = 'active';
    return { ...quest, steps };
  }
  return quest;
}
function rejectQuest(quest: WorkerQuest | null): WorkerQuest | null {
  if (!quest) return quest;
  const steps = quest.steps.map((step) => ({ ...step }));
  const activeIdx = steps.findIndex((step) => step.status === 'active');
  if (activeIdx >= 0) steps[activeIdx].status = 'rejected';
  return { ...quest, steps };
}
function rejectQuestStep(quest: WorkerQuest | null, stepId: string): WorkerQuest | null {
  if (!quest) return quest;
  const steps = quest.steps.map((step) => step.id === stepId && step.status === 'completed'
    ? { ...step, status: 'rejected' as WorkerQuestStepStatus }
    : { ...step });
  return { ...quest, steps };
}
function addQuestStep(quest: WorkerQuest | null, text: string): WorkerQuest | null {
  const clean = trimText(text);
  if (!quest || !clean) return quest;
  const steps = quest.steps.map((step) => ({ ...step }));
  const nextStep: WorkerQuestStep = {
    id: 'step-' + randomHex(6),
    text: clean,
    status: 'pending',
  };
  const insertAt = steps.length > 0 ? steps.length - 1 : 0;
  steps.splice(insertAt, 0, nextStep);
  return { ...quest, steps };
}
function splitWords(text: string): string[] {
  const raw = trimText(text).split(' ');
  const out: string[] = [];
  for (const w of raw) if (w && w.length > 0) out.push(w);
  return out;
}
function joinWords(parts: string[], start: number): string {
  let out = '';
  for (let i = start; i < parts.length; i++) {
    if (i > start) out = out + ' ';
    out = out + parts[i];
  }
  return trimText(out);
}
function normalizeBackend(name: string): string {
  const lower = trimText(name).toLowerCase();
  if (lower === 'claude' || lower === 'anthropic') return 'claude';
  if (lower === 'kimi' || lower === 'moonshot') return 'kimi';
  if (lower === 'local' || lower === 'llama' || lower === 'qwen' || lower === 'localai') return 'local';
  return '';
}
function backendDisplayName(name: string): string {
  if (name === 'claude') return 'Claude';
  if (name === 'kimi') return 'Kimi';
  if (name === 'local') return 'Local';
  return 'Worker';
}
function backendLetter(name: string): string {
  if (name === 'claude') return 'C';
  if (name === 'kimi') return 'K';
  if (name === 'local') return 'L';
  return 'W';
}
function backendColor(name: string): string {
  if (name === 'claude') return '#D97757';
  if (name === 'kimi') return '#C4B5FD';
  if (name === 'local') return '#10a37f';
  return '#6B7585';
}
function modelDisplayLabel(backendName: string, model: string): string {
  const clean = trimText(model);
  if (!clean) return '';
  if (normalizeBackend(backendName) !== 'local') return clean;
  let lastSep = -1;
  for (let i = 0; i < clean.length; i++) {
    const cc = clean.charCodeAt(i);
    if (cc === 47 || cc === 92) lastSep = i;
  }
  if (lastSep >= 0 && lastSep + 1 < clean.length) return clean.substring(lastSep + 1);
  return clean;
}
function backendModelShortLabel(backendName: string, model: string): string {
  const backend = normalizeBackend(backendName);
  const clean = trimText(model);
  if (!clean) return '';
  if (backend === 'claude' && clean === 'claude-opus-4-7') return 'Opus 4.7';
  if (backend === 'claude' && clean === 'claude-sonnet-4-6') return 'Sonnet 4.6';
  if (backend === 'claude' && clean === 'claude-haiku-4-5') return 'Haiku 4.5';
  if (backend === 'kimi' && clean === 'kimi-code/kimi-for-coding') return 'Kimi Code';
  if (backend === 'kimi' && clean === 'kimi-k2.5') return 'K2.5';
  if (backend === 'kimi' && clean === 'kimi-k2') return 'K2';
  if (backend === 'kimi' && clean === 'kimi-k2-thinking') return 'K2 Thinking';
  return modelDisplayLabel(backend, clean);
}
function variantIdForConfig(backendName: string, modelName: string): string {
  for (const [variantId, cfg] of Object.entries(VARIANT_MAP)) {
    if (cfg.backend === backendName && cfg.model === modelName) return variantId;
  }
  return '';
}
function blankSlots(): string[] {
  return new Array(MAX_MSGS).fill('');
}
function randomHex(count: number): string {
  let out = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < count; i++) out = out + hex[(Math.random() * 16) | 0];
  return out;
}
function makeSessionUuid(): string {
  const part1 = randomHex(8);
  const part2 = randomHex(4);
  const part3 = '4' + randomHex(3);
  const part4 = (8 + ((Math.random() * 4) | 0)).toString(16) + randomHex(3);
  const part5 = randomHex(12);
  return part1 + '-' + part2 + '-' + part3 + '-' + part4 + '-' + part5;
}
function workerShellHeight(worker: WorkerState): number {
  return CARD_H + (worker.quest ? QUEST_ATTACH_GAP + QUEST_ATTACH_H : 0);
}
function layoutWorkers(workers: WorkerState[]): WorkerState[] {
  const rowHeights: number[] = [];
  for (let i = 0; i < workers.length; i++) {
    const row = Math.floor(i / WORKER_COLS);
    const h = workerShellHeight(workers[i]);
    if (!rowHeights[row] || h > rowHeights[row]) rowHeights[row] = h;
  }
  const rowOffsets: number[] = [];
  let nextY = CARD_Y;
  for (let row = 0; row < rowHeights.length; row++) {
    rowOffsets[row] = nextY;
    nextY = nextY + rowHeights[row] + CARD_GAP_Y;
  }
  return workers.map((worker, index) => {
    const col = index % WORKER_COLS;
    const row = Math.floor(index / WORKER_COLS);
    return {
      ...worker,
      gx: CARD_X + (col * (CARD_W + CARD_GAP_X)),
      gy: rowOffsets[row] || CARD_Y,
      gw: CARD_W,
      gh: workerShellHeight(worker),
    };
  });
}
function workerCenterX(worker: WorkerState): number { return worker.gx + (worker.gw / 2); }
function workerCenterY(worker: WorkerState): number { return worker.gy + (worker.gh / 2); }
function makeWorker(index: number, spawnMenuOpen: boolean): WorkerState {
  return {
    id: 'worker-' + String(index + 1),
    label: 'worker ' + String(index + 1),
    gx: CARD_X + ((index % WORKER_COLS) * (CARD_W + CARD_GAP_X)),
    gy: CARD_Y,
    gw: CARD_W,
    gh: CARD_H,
    initState: 0,
    selectedBackend: '',
    selectedModel: '',
    activeBackend: '',
    activeModel: '',
    sessionId: '',
    claudeSessionId: '',
    claudeSessionModel: '',
    kimiSessionId: makeSessionUuid(),
    kimiSessionModel: '',
    localSessionId: '',
    localSessionModel: '',
    turnCount: 0,
    turnText: 'turns 0',
    totalCost: 0,
    costText: '$0.0000',
    isStreaming: 0,
    isConnecting: false,
    spawnMenuOpen,
    selectedVariant: 'opus-4-7',
    selectedEffort: 'high',
    selectedContext: '200k',
    msgCount: 0,
    kinds: blankSlots(),
    texts: blankSlots(),
    activeContentKind: '',
    turnHasAssistantText: false,
    quest: null,
  };
}
function appendMsgToWorker(worker: WorkerState, kind: string, text: string): WorkerState {
  if (worker.msgCount >= MAX_MSGS) {
    const nextKinds = worker.kinds.slice(1);
    nextKinds.push(kind);
    const nextTexts = worker.texts.slice(1);
    nextTexts.push(text);
    return { ...worker, kinds: nextKinds, texts: nextTexts };
  }
  const nextKinds = worker.kinds.slice();
  const nextTexts = worker.texts.slice();
  nextKinds[worker.msgCount] = kind;
  nextTexts[worker.msgCount] = text;
  return {
    ...worker,
    msgCount: worker.msgCount + 1,
    kinds: nextKinds,
    texts: nextTexts,
  };
}
function appendToLastKind(worker: WorkerState, kind: string, delta: string): WorkerState {
  if (worker.msgCount === 0) return appendMsgToWorker(worker, kind, delta);
  const lastIdx = worker.msgCount - 1;
  if (worker.kinds[lastIdx] !== kind) return appendMsgToWorker(worker, kind, delta);
  const nextTexts = worker.texts.slice();
  nextTexts[lastIdx] = (nextTexts[lastIdx] || '') + delta;
  return { ...worker, texts: nextTexts };
}
function clearWorkerContent(worker: WorkerState): WorkerState {
  if (!worker.activeContentKind) return worker;
  return { ...worker, activeContentKind: '' };
}
function appendContentChunk(worker: WorkerState, kind: string, delta: string): WorkerState {
  const chunk = delta || '';
  if (!chunk) return worker;
  if (worker.activeContentKind === kind) return appendToLastKind(worker, kind, chunk);
  const next = appendMsgToWorker(worker, kind, chunk);
  return { ...next, activeContentKind: kind };
}
function finishTurn(worker: WorkerState, nextCost: number): WorkerState {
  const turnCount = worker.turnCount + 1;
  return {
    ...clearWorkerContent(worker),
    isStreaming: 0,
    turnCount,
    turnText: 'turns ' + String(turnCount),
    totalCost: nextCost,
    costText: '$' + nextCost.toFixed(4),
  };
}

// ── Action slot ─────────────────────────────────────────────────────────
// hoverable + tooltip live on the inner ActionSlotFrame so the +20 brighten
// is actually visible (the outer Pressable is 62×62 and almost fully covered
// by the 56×56 Frame, so hover feedback on the outer was invisible).
function ActionSlot(props: any) {
  const { slot, glyph, label, flash, onPress, tooltip } = props;
  const isFlashing = flash === slot;
  return (
    <C.ActionSlot onPress={onPress}>
      <C.ActionSlotFrame hoverable={1} tooltip={tooltip}>
        {isFlashing && <C.ActionSlotGlow />}
        <C.ActionSlotKey>{String(slot)}</C.ActionSlotKey>
        <C.ActionSlotGlyph>{glyph}</C.ActionSlotGlyph>
        <C.ActionSlotLabel>{label}</C.ActionSlotLabel>
      </C.ActionSlotFrame>
    </C.ActionSlot>
  );
}

const ACTIONS = [
  { slot: 1, glyph: '✦', label: 'scan',  tooltip: 'Prime scan prompt to the input' },
  { slot: 2, glyph: '⌘', label: 'plan',  tooltip: 'Prime planning prompt to the input' },
  { slot: 3, glyph: '⌖', label: 'patch', tooltip: 'Prime patch prompt to the input' },
  { slot: 4, glyph: '◈', label: 'audit', tooltip: 'Prime audit prompt to the input' },
  { slot: 5, glyph: '✧', label: 'ship',  tooltip: 'Prime ship summary prompt to the input' },
  { slot: 6, glyph: '⬢', label: 'clear', tooltip: 'Clear the current draft input' },
];

// ── App ─────────────────────────────────────────────────────────────────
export default function App() {
  const initialWorkersRef = useRef<WorkerState[]>([]);
  if (initialWorkersRef.current.length === 0) initialWorkersRef.current = layoutWorkers([makeWorker(0, true)]);
  const initialWorker = initialWorkersRef.current[0];

  const [activeTheme, setActiveTheme] = useState(0);
  const [workers, setWorkers] = useState<WorkerState[]>(() => initialWorkersRef.current);
  const workersRef = useRef<WorkerState[]>(initialWorkersRef.current);
  const [activeWorkerId, setActiveWorkerId] = useState(initialWorker.id);
  const activeWorkerIdRef = useRef(initialWorker.id);
  const [viewX, setViewX] = useState(workerCenterX(initialWorker));
  const [viewY, setViewY] = useState(workerCenterY(initialWorker));
  const [viewZoom, setViewZoom] = useState(1);
  const [expandedQuestId, setExpandedQuestId] = useState('');
  const [draft, setDraft] = useState('');
  const [actionFlash, setActionFlash] = useState(0);

  const connectedWorkerIdRef = useRef('');
  const connectedBackendRef = useRef('');

  useEffect(() => { workersRef.current = workers; }, [workers]);
  useEffect(() => { activeWorkerIdRef.current = activeWorkerId; }, [activeWorkerId]);

  function updateWorkersState(updater: (prev: WorkerState[]) => WorkerState[]) {
    const next = layoutWorkers(updater(workersRef.current));
    workersRef.current = next;
    setWorkers(next);
  }

  function updateWorkerState(workerId: string, updater: (worker: WorkerState) => WorkerState) {
    updateWorkersState((prev) => prev.map((worker) => worker.id === workerId ? updater(worker) : worker));
  }

  function appendWorkerMessage(workerId: string, kind: string, text: string) {
    updateWorkerState(workerId, (worker) => appendMsgToWorker(worker, kind, text));
  }

  function getWorker(workerId: string): WorkerState | null {
    const list = workersRef.current;
    for (let i = 0; i < list.length; i++) if (list[i].id === workerId) return list[i];
    return null;
  }

  function currentWorkDir(): string {
    return getenv('PWD') || getenv('HOME') || '/tmp';
  }

  function focusWorkerById(workerId: string) {
    const worker = getWorker(workerId);
    if (!worker) return;
    activeWorkerIdRef.current = workerId;
    setActiveWorkerId(workerId);
    setViewX(workerCenterX(worker));
    setViewY(workerCenterY(worker));
    setViewZoom(1);
  }

  function syncWorkerVariant(worker: WorkerState, backendName: string, modelName: string): WorkerState {
    const nextVariant = variantIdForConfig(backendName, modelName);
    if (!nextVariant) return worker;
    if (worker.selectedVariant === nextVariant) return worker;
    return { ...worker, selectedVariant: nextVariant };
  }

  function prepareWorkerSelection(worker: WorkerState, backendName: string, modelName: string): WorkerState {
    const backend = normalizeBackend(backendName);
    const model = trimText(modelName);
    let next = { ...worker, selectedBackend: backend, selectedModel: model };
    next = syncWorkerVariant(next, backend, model);
    if (backend === 'claude' && next.claudeSessionModel && next.claudeSessionModel !== model) {
      next = { ...next, claudeSessionId: '', claudeSessionModel: '' };
      if (next.sessionId) next = { ...next, sessionId: '' };
    }
    if (backend === 'kimi' && next.kimiSessionModel && next.kimiSessionModel !== model) {
      next = { ...next, kimiSessionId: makeSessionUuid(), kimiSessionModel: '' };
      if (next.sessionId) next = { ...next, sessionId: '' };
    }
    if (backend === 'local' && next.localSessionModel && next.localSessionModel !== model) {
      next = { ...next, localSessionId: '', localSessionModel: '' };
      if (next.sessionId) next = { ...next, sessionId: '' };
    }
    return next;
  }

  function storedSessionId(worker: WorkerState, backendName: string, modelName: string): string {
    const backend = normalizeBackend(backendName);
    const model = trimText(modelName);
    if (backend === 'claude') return worker.claudeSessionModel === model ? worker.claudeSessionId : '';
    if (backend === 'kimi') return worker.kimiSessionId;
    if (backend === 'local') return worker.localSessionModel === model ? worker.localSessionId : '';
    return '';
  }

  function closeConnectedSession(announce: number) {
    const workerId = connectedWorkerIdRef.current;
    if (!workerId) return;
    const worker = getWorker(workerId);
    const backend = connectedBackendRef.current || (worker ? worker.activeBackend : '');
    if (backend === 'claude') claude_close();
    else if (backend === 'kimi') kimi_close();
    else if (backend === 'local') localai_close();
    connectedWorkerIdRef.current = '';
    connectedBackendRef.current = '';
    if (!worker) return;
    updateWorkerState(workerId, (current) => {
      let next = clearWorkerContent(current);
      next = {
        ...next,
        activeBackend: '',
        activeModel: '',
        sessionId: '',
        initState: 0,
        isStreaming: 0,
        isConnecting: false,
      };
      if (backend && announce) next = appendMsgToWorker(next, 'system', 'disconnected ' + backendDisplayName(backend));
      return next;
    });
  }

  function connectWorkerBackend(workerId: string, backendName: string, modelName: string, announce: number): number {
    const backend = normalizeBackend(backendName);
    const model = trimText(modelName);
    if (!backend) {
      appendWorkerMessage(workerId, 'system', 'unknown backend: ' + backendName);
      updateWorkerState(workerId, (worker) => ({ ...worker, initState: 2, isConnecting: false }));
      return 0;
    }
    if (!model) {
      appendWorkerMessage(workerId, 'system', 'select a model first with /model <model> or /use ' + backend + ' <model>');
      updateWorkerState(workerId, (worker) => ({ ...worker, initState: 0, isConnecting: false }));
      return 0;
    }

    const existing = getWorker(workerId);
    if (existing && existing.initState === 1 && existing.activeBackend === backend && existing.activeModel === model && connectedWorkerIdRef.current === workerId) {
      updateWorkerState(workerId, (worker) => ({ ...worker, isConnecting: false }));
      return 1;
    }

    if (connectedWorkerIdRef.current && (connectedWorkerIdRef.current !== workerId || connectedBackendRef.current !== backend || (existing && existing.activeModel !== model))) {
      closeConnectedSession(announce);
    }

    const worker = getWorker(workerId);
    if (!worker) return 0;
    const cwd = currentWorkDir();
    const resumeSessionId = storedSessionId(worker, backend, model);
    let ok = 0;
    if (backend === 'claude') ok = claude_init(cwd, model, resumeSessionId || undefined);
    else if (backend === 'kimi') ok = kimi_init(cwd, model, resumeSessionId || undefined);
    else if (backend === 'local') ok = localai_init(cwd, model, resumeSessionId || undefined);

    if (ok) {
      connectedWorkerIdRef.current = workerId;
      connectedBackendRef.current = backend;
      updateWorkerState(workerId, (current) => {
        let next = {
          ...current,
          selectedBackend: backend,
          selectedModel: model,
          activeBackend: backend,
          activeModel: model,
          initState: 1,
          isStreaming: 0,
          isConnecting: false,
          spawnMenuOpen: false,
        };
        if (backend === 'kimi') {
          next = {
            ...next,
            sessionId: current.kimiSessionId,
            kimiSessionModel: model,
          };
        }
        return next;
      });
      if (announce) appendWorkerMessage(workerId, 'system', 'connected ' + backendDisplayName(backend) + ' · ' + model);
      return 1;
    }

    connectedWorkerIdRef.current = '';
    connectedBackendRef.current = '';
    updateWorkerState(workerId, (current) => ({
      ...current,
      selectedBackend: backend,
      selectedModel: model,
      activeBackend: '',
      activeModel: '',
      sessionId: '',
      initState: 2,
      isStreaming: 0,
      isConnecting: false,
    }));
    appendWorkerMessage(workerId, 'system', 'failed to start ' + backendDisplayName(backend) + ' · ' + model + ' (backend CLI not wired on this build)');
    return 0;
  }

  function ensureWorkerConnected(workerId: string, announce: number): string {
    const worker = getWorker(workerId);
    if (!worker) return '';
    const backend = normalizeBackend(worker.selectedBackend);
    const model = trimText(worker.selectedModel);
    if (!backend || !model) {
      appendWorkerMessage(workerId, 'system', 'set backend + model first with /use <claude|kimi|local> <model>');
      return '';
    }
    if (worker.initState === 1 && worker.activeBackend === backend && worker.activeModel === model && connectedWorkerIdRef.current === workerId) {
      return backend;
    }
    if (connectWorkerBackend(workerId, backend, model, announce)) return backend;
    return '';
  }

  function workerStatusLine(worker: WorkerState): string {
    const state = worker.initState === 1 ? 'connected' : worker.initState === 2 ? 'error' : 'idle';
    const selectedModelLabel = modelDisplayLabel(worker.selectedBackend, worker.selectedModel) || 'none';
    const activeModelLabel = modelDisplayLabel(worker.activeBackend, worker.activeModel) || 'none';
    const selected = (worker.selectedBackend ? backendDisplayName(worker.selectedBackend) : 'none') + ' / ' + selectedModelLabel;
    const active = worker.activeBackend ? backendDisplayName(worker.activeBackend) + ' / ' + activeModelLabel : 'none';
    const sid = worker.sessionId || 'n/a';
    return 'state ' + state + ' | selected ' + selected + ' | active ' + active + ' | session ' + sid;
  }

  function handleChatCommand(workerId: string, text: string) {
    const parts = splitWords(text);
    if (parts.length === 0) return;
    const cmd = parts[0].toLowerCase();
    if (cmd === '/use') {
      if (parts.length < 3) { appendWorkerMessage(workerId, 'system', 'usage: /use <claude|kimi|local> <model>'); return; }
      const backend = normalizeBackend(parts[1]);
      if (!backend) { appendWorkerMessage(workerId, 'system', 'unknown backend: ' + parts[1]); return; }
      const model = joinWords(parts, 2);
      updateWorkerState(workerId, (worker) => prepareWorkerSelection(worker, backend, model));
      connectWorkerBackend(workerId, backend, model, 1);
      return;
    }
    if (cmd === '/backend') {
      if (parts.length < 2) { appendWorkerMessage(workerId, 'system', 'usage: /backend <claude|kimi|local>'); return; }
      const backend = normalizeBackend(parts[1]);
      if (!backend) { appendWorkerMessage(workerId, 'system', 'unknown backend: ' + parts[1]); return; }
      updateWorkerState(workerId, (worker) => ({ ...worker, selectedBackend: backend }));
      appendWorkerMessage(workerId, 'system', 'backend set to ' + backendDisplayName(backend));
      return;
    }
    if (cmd === '/model') {
      if (parts.length < 2) { appendWorkerMessage(workerId, 'system', 'usage: /model <model>'); return; }
      const model = joinWords(parts, 1);
      updateWorkerState(workerId, (worker) => worker.selectedBackend ? prepareWorkerSelection(worker, worker.selectedBackend, model) : { ...worker, selectedModel: model });
      appendWorkerMessage(workerId, 'system', 'model set to ' + model);
      return;
    }
    if (cmd === '/connect') { ensureWorkerConnected(workerId, 1); return; }
    if (cmd === '/disconnect') {
      if (connectedWorkerIdRef.current === workerId) closeConnectedSession(1);
      else appendWorkerMessage(workerId, 'system', 'worker not connected');
      return;
    }
    if (cmd === '/status') {
      const worker = getWorker(workerId);
      if (worker) appendWorkerMessage(workerId, 'system', workerStatusLine(worker));
      return;
    }
    if (cmd === '/help') { appendWorkerMessage(workerId, 'system', COMMAND_HELP); return; }
    appendWorkerMessage(workerId, 'system', 'unknown command: ' + cmd);
    appendWorkerMessage(workerId, 'system', COMMAND_HELP);
  }

  function handleChatInput(text: string) {
    const worker = getWorker(activeWorkerIdRef.current);
    if (!worker) return;
    const clean = trimText(text);
    if (!clean) return;
    if (clean.charCodeAt(0) === 47) {
      handleChatCommand(worker.id, clean);
      setDraft('');
      return;
    }
    const backend = ensureWorkerConnected(worker.id, 1);
    if (!backend) return;
    updateWorkerState(worker.id, (current) => {
      let next = { ...current, spawnMenuOpen: false };
      next = clearWorkerContent(next);
      next = { ...next, turnHasAssistantText: false };
      next = { ...next, quest: buildQuestFromPrompt(clean) };
      next = appendMsgToWorker(next, 'user', clean);
      return next;
    });
    let ok = 0;
    if (backend === 'claude') ok = claude_send(clean);
    else if (backend === 'kimi') ok = kimi_send(clean);
    else if (backend === 'local') ok = localai_send(clean);
    if (!ok) {
      updateWorkerState(worker.id, (current) => {
        let next = appendMsgToWorker(current, 'result', 'error: send failed');
        next = clearWorkerContent(next);
        next = { ...next, quest: rejectQuest(next.quest) };
        return { ...next, isStreaming: 0 };
      });
      return;
    }
    setDraft('');
    updateWorkerState(worker.id, (current) => ({ ...current, isStreaming: 1 }));
  }

  function createWorkerCard() {
    const nextWorker = makeWorker(workersRef.current.length, true);
    updateWorkersState((prev) => {
      const closed = prev.map((worker) => worker.spawnMenuOpen ? { ...worker, spawnMenuOpen: false } : worker);
      return closed.concat(nextWorker);
    });
    activeWorkerIdRef.current = nextWorker.id;
    setActiveWorkerId(nextWorker.id);
    setViewX(workerCenterX(nextWorker));
    setViewY(workerCenterY(nextWorker));
    setViewZoom(1);
  }

  function toggleWorkerSpawnMenu(workerId: string) {
    focusWorkerById(workerId);
    updateWorkersState((prev) => prev.map((worker) => {
      if (worker.id !== workerId) return worker;
      return { ...worker, spawnMenuOpen: !worker.spawnMenuOpen };
    }));
  }

  function selectWorkerVariant(workerId: string, variantId: string) {
    const cfg = VARIANT_MAP[variantId];
    if (!cfg) return;
    focusWorkerById(workerId);
    updateWorkerState(workerId, (worker) => {
      let next = prepareWorkerSelection(worker, cfg.backend, cfg.model);
      next = { ...next, selectedVariant: variantId, spawnMenuOpen: false, isConnecting: true };
      return next;
    });
    setTimeout(() => connectWorkerBackend(workerId, cfg.backend, cfg.model, 0), 0);
  }

  function spawnPreset(workerId: string, backendName: string, modelName: string) {
    focusWorkerById(workerId);
    updateWorkerState(workerId, (worker) => {
      let next = prepareWorkerSelection(worker, backendName, modelName);
      next = { ...next, spawnMenuOpen: false, isConnecting: true };
      return next;
    });
    setTimeout(() => connectWorkerBackend(workerId, backendName, modelName, 0), 0);
  }

  function selectWorkerContext(workerId: string, ctx: string) {
    focusWorkerById(workerId);
    updateWorkerState(workerId, (worker) => {
      if (ctx !== 'reset') return { ...worker, selectedContext: ctx };
      let next = {
        ...worker,
        selectedContext: ctx,
        msgCount: 0,
        kinds: blankSlots(),
        texts: blankSlots(),
        activeContentKind: '',
        quest: null,
      };
      next = appendMsgToWorker(next, 'system', 'context window reset');
      return next;
    });
  }

  function rejectWorkerQuestStep(workerId: string, stepId: string) {
    updateWorkerState(workerId, (worker) => ({ ...worker, quest: rejectQuestStep(worker.quest, stepId) }));
  }

  function addWorkerQuestStep(workerId: string, text: string) {
    updateWorkerState(workerId, (worker) => ({ ...worker, quest: addQuestStep(worker.quest, text) }));
  }

  function announceUnavailable(workerId: string, providerName: string, modelName: string) {
    appendWorkerMessage(workerId, 'system', providerName + ' lane not wired yet · ' + modelName);
  }

  function primeAction(slot: number) {
    if (slot < 1 || slot > ACTIONS.length) return;
    if (slot === 6) setDraft('');
    setActionFlash(slot);
    setTimeout(() => setActionFlash(0), 180);
  }

  // ── Event handlers (per-backend message shape) ─────────────────────
  // Shape contracts live in framework/qjs_runtime.zig (claudeMessageToJs /
  // kimiMessageToJs / localAiEventToJs).

  function reduceClaudeEvent(worker: WorkerState, evt: any): WorkerState {
    if (!evt) return worker;
    let next = worker;
    if (evt.type === 'system') {
      next = clearWorkerContent(next);
      if (evt.model) next = { ...next, selectedModel: evt.model, activeModel: evt.model, claudeSessionModel: evt.model };
      if (evt.session_id) {
        next = {
          ...next,
          sessionId: evt.session_id,
          claudeSessionId: evt.session_id,
          claudeSessionModel: evt.model || next.activeModel || next.selectedModel,
        };
      }
      return next;
    }
    if (evt.type === 'assistant') {
      const blocks = evt.content || [];
      let appendedAssistant = false;
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.type === 'text') {
          const text = block.text || '';
          let s = 0;
          while (s < text.length) {
            const cc = text.charCodeAt(s);
            if (cc !== 10 && cc !== 13 && cc !== 32 && cc !== 9) break;
            s = s + 1;
          }
          let e = text.length;
          while (e > s) {
            const cc2 = text.charCodeAt(e - 1);
            if (cc2 !== 10 && cc2 !== 13 && cc2 !== 32 && cc2 !== 9) break;
            e = e - 1;
            }
          if (e > s) {
            next = appendContentChunk(next, 'assistant', text.substring(s, e));
            appendedAssistant = true;
          }
        } else if (block.type === 'thinking') {
          next = appendContentChunk(next, 'thinking', block.thinking || '');
        } else if (block.type === 'tool_use') {
          next = clearWorkerContent(next);
          next = { ...next, quest: advanceQuest(next.quest, 'tool') };
          next = appendMsgToWorker(next, 'tool', (block.name || 'tool') + '(' + (block.input_json || '') + ')');
        }
      }
      if (!appendedAssistant && evt.text) {
        const fallbackText = trimText(evt.text);
        if (fallbackText) {
          next = appendContentChunk(next, 'assistant', fallbackText);
          appendedAssistant = true;
        }
      }
      if (appendedAssistant) next = { ...next, turnHasAssistantText: true, quest: advanceQuest(next.quest, 'assistant') };
      return next;
    }
    if (evt.type === 'result') {
      const fallbackText = trimText(evt.result || '');
      if (!evt.is_error && !next.turnHasAssistantText && fallbackText) {
        next = appendMsgToWorker(next, 'assistant', fallbackText);
        next = { ...next, turnHasAssistantText: true, quest: advanceQuest(next.quest, 'assistant') };
      }
      next = finishTurn(next, evt.total_cost_usd || 0);
      if (evt.session_id) {
        next = {
          ...next,
          sessionId: evt.session_id,
          claudeSessionId: evt.session_id,
          claudeSessionModel: next.activeModel || next.selectedModel,
        };
      }
      if (evt.is_error && evt.result) {
        next = { ...next, quest: rejectQuest(next.quest) };
        next = appendMsgToWorker(next, 'result', 'error: ' + evt.result);
      }
      return { ...next, turnHasAssistantText: false };
    }
    return next;
  }

  function reduceKimiEvent(worker: WorkerState, evt: any): WorkerState {
    if (!evt) return worker;
    let next = worker;
    if (evt.type === 'turn_begin') {
      next = clearWorkerContent(next);
      return { ...next, turnHasAssistantText: false };
    }
    if (evt.type === 'assistant_part') {
      if (evt.part_type === 'thinking' && evt.text) {
        next = appendContentChunk(next, 'thinking', evt.text);
      } else if (evt.text) {
        next = appendContentChunk(next, 'assistant', evt.text);
        next = { ...next, turnHasAssistantText: true, quest: advanceQuest(next.quest, 'assistant') };
      }
      return next;
    }
    if (evt.type === 'tool_call') {
      next = clearWorkerContent(next);
      next = { ...next, quest: advanceQuest(next.quest, 'tool') };
      let toolLine = evt.name || 'tool';
      if (evt.input_json) toolLine = toolLine + '(' + evt.input_json + ')';
      next = appendMsgToWorker(next, 'tool', toolLine);
      return next;
    }
    if (evt.type === 'tool_result') {
      next = clearWorkerContent(next);
      const resultLine = evt.text || 'tool result';
      next = appendMsgToWorker(next, 'result', evt.is_error ? 'error: ' + resultLine : resultLine);
      return next;
    }
    if (evt.type === 'status') {
      next = clearWorkerContent(next);
      if (evt.text) next = appendMsgToWorker(next, evt.is_error ? 'result' : 'system', evt.is_error ? 'error: ' + evt.text : evt.text);
      return next;
    }
    if (evt.type === 'result') {
      const fallbackText = trimText(evt.result || '');
      if (!evt.is_error && !next.turnHasAssistantText && fallbackText && fallbackText.charCodeAt(0) !== 123) {
        next = appendMsgToWorker(next, 'assistant', fallbackText);
        next = { ...next, turnHasAssistantText: true, quest: advanceQuest(next.quest, 'assistant') };
      }
      next = finishTurn(next, next.totalCost || 0);
      if (evt.is_error && evt.result) {
        next = { ...next, quest: rejectQuest(next.quest) };
        next = appendMsgToWorker(next, 'result', 'error: ' + evt.result);
      }
      return { ...next, turnHasAssistantText: false };
    }
    return next;
  }

  function reduceLocalEvent(worker: WorkerState, evt: any): WorkerState {
    if (!evt) return worker;
    let next = worker;
    if (evt.type === 'system') {
      next = clearWorkerContent(next);
      if (evt.model) next = { ...next, selectedModel: evt.model, activeModel: evt.model, localSessionModel: evt.model };
      if (evt.session_id) {
        next = {
          ...next,
          sessionId: evt.session_id,
          localSessionId: evt.session_id,
          localSessionModel: evt.model || next.activeModel || next.selectedModel,
        };
      }
      return next;
    }
    if (evt.type === 'assistant_part') {
      if (evt.part_type === 'thinking' && evt.text) {
        next = appendContentChunk(next, 'thinking', evt.text);
      } else if (evt.text) {
        next = appendContentChunk(next, 'assistant', evt.text);
        next = { ...next, turnHasAssistantText: true, quest: advanceQuest(next.quest, 'assistant') };
      }
      return next;
    }
    if (evt.type === 'status') {
      next = clearWorkerContent(next);
      if (evt.text) next = appendMsgToWorker(next, evt.is_error ? 'result' : 'system', evt.is_error ? 'error: ' + evt.text : evt.text);
      return next;
    }
    if (evt.type === 'result') {
      const fallbackText = trimText(evt.result || '');
      if (!evt.is_error && !next.turnHasAssistantText && fallbackText) {
        next = appendMsgToWorker(next, 'assistant', fallbackText);
        next = { ...next, turnHasAssistantText: true, quest: advanceQuest(next.quest, 'assistant') };
      }
      next = finishTurn(next, next.totalCost || 0);
      if (evt.is_error && evt.result) {
        next = { ...next, quest: rejectQuest(next.quest) };
        next = appendMsgToWorker(next, 'result', 'error: ' + evt.result);
      }
      return { ...next, turnHasAssistantText: false };
    }
    return next;
  }

  function applyWorkerEventSnapshot(prev: WorkerState[], workerId: string, reducer: (worker: WorkerState, evt: any) => WorkerState, evt: any): WorkerState[] {
    let changed = false;
    const next = prev.map((worker) => {
      if (worker.id !== workerId) return worker;
      const updated = reducer(worker, evt);
      if (updated !== worker) changed = true;
      return updated;
    });
    return changed ? next : prev;
  }

  // Reducer closures are re-created each render; stash the latest versions
  // in a ref so the mount-time setInterval always calls the fresh copies.
  const reducersRef = useRef({
    claude: reduceClaudeEvent,
    kimi: reduceKimiEvent,
    local: reduceLocalEvent,
  });
  reducersRef.current.claude = reduceClaudeEvent;
  reducersRef.current.kimi = reduceKimiEvent;
  reducersRef.current.local = reduceLocalEvent;

  // ── Event poll loop ────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      let drained = 0;
      let nextWorkers = workersRef.current;
      while (drained < 16) {
        const workerId = connectedWorkerIdRef.current;
        const backend = connectedBackendRef.current;
        if (!workerId || !backend) break;
        let evt: any = null;
        if (backend === 'claude') evt = claude_poll();
        else if (backend === 'kimi') evt = kimi_poll();
        else if (backend === 'local') evt = localai_poll();
        if (!evt) break;
        drained = drained + 1;
        if (backend === 'claude') nextWorkers = applyWorkerEventSnapshot(nextWorkers, workerId, reducersRef.current.claude, evt);
        else if (backend === 'kimi') nextWorkers = applyWorkerEventSnapshot(nextWorkers, workerId, reducersRef.current.kimi, evt);
        else if (backend === 'local') nextWorkers = applyWorkerEventSnapshot(nextWorkers, workerId, reducersRef.current.local, evt);
      }
      if (nextWorkers !== workersRef.current) {
        const laidOut = layoutWorkers(nextWorkers);
        workersRef.current = laidOut;
        setWorkers(laidOut);
      }
    }, 16);
    return () => clearInterval(id);
  }, []);

  // ── Derived ────────────────────────────────────────────────────────
  const activeWorker = (() => {
    for (let i = 0; i < workers.length; i++) if (workers[i].id === activeWorkerId) return workers[i];
    return workers[0] || null;
  })();
  const activeBackend = activeWorker ? (activeWorker.activeBackend || activeWorker.selectedBackend) : '';
  const activeModel = activeWorker ? (activeWorker.activeModel || activeWorker.selectedModel) : '';
  const paneLabelText = (() => {
    const modelLabel = modelDisplayLabel(activeBackend, activeModel);
    if (!activeBackend && !activeModel) return 'unconfigured';
    if (activeBackend && modelLabel) return backendDisplayName(activeBackend) + ' · ' + modelLabel;
    if (activeBackend) return backendDisplayName(activeBackend);
    return modelLabel;
  })();
  const inputPlaceholder = (() => {
    if (!activeWorker) return 'spawn a worker first';
    if (!activeWorker.selectedBackend || !activeWorker.selectedModel) return 'set backend + model with /use <claude|kimi|local> <model>';
    if (activeWorker.initState === 2) return 'connection failed - is the CLI on PATH?';
    if (activeWorker.isStreaming === 1) return 'streaming ' + backendDisplayName(activeBackend).toLowerCase() + '...';
    if (activeWorker.initState === 1 && connectedWorkerIdRef.current === activeWorker.id) return 'ask ' + backendDisplayName(activeBackend).toLowerCase() + '...';
    return 'press send or Enter to connect ' + backendDisplayName(activeWorker.selectedBackend).toLowerCase() + '...';
  })();
  const bottomTurnText = activeWorker ? activeWorker.turnText : 'turns 0';
  const bottomCostText = activeWorker ? activeWorker.costText : '$0.0000';
  const nextTheme = (activeTheme + 1) % THEMES.length;

  return (
    <ThemeProvider colors={THEMES[activeTheme]}>
      <C.Root>
        <C.Shell>
          <C.Page>
            <C.SegmentsRow>
              <C.Segment1 />
              <C.Segment2>
                <C.SegmentFlipLabel>{paneLabelText}</C.SegmentFlipLabel>
              </C.Segment2>
              <C.Segment3 />
            </C.SegmentsRow>
            <C.PageCanvasWrap>
              <Canvas style={{ flexGrow: 1, flexBasis: 0 }} viewX={viewX} viewY={viewY} viewZoom={viewZoom}>
                {workers.map((worker) => {
                  const selectedOrActiveBackend = worker.activeBackend || worker.selectedBackend;
                  const selectedOrActiveModel = worker.activeModel || worker.selectedModel;
                  const isSelected = activeWorkerId === worker.id;
                  const selectionColor = selectedOrActiveBackend ? backendColor(selectedOrActiveBackend) : 'theme:borderFocus';
                  const modelLabel = modelDisplayLabel(selectedOrActiveBackend, selectedOrActiveModel) || 'no model selected';
                  const spawnStatusText = (() => {
                    if (worker.initState === 1) {
                      return 'active ' + backendDisplayName(selectedOrActiveBackend) + ' · ' + (backendModelShortLabel(selectedOrActiveBackend, selectedOrActiveModel) || selectedOrActiveModel || 'ready');
                    }
                    if (worker.initState === 2) return 'last launch failed';
                    return 'click a lane to launch';
                  })();
                  const chatSlotProps: Record<string, any> = {};
                  for (let i = 0; i < MAX_MSGS; i++) {
                    chatSlotProps['mk' + i] = worker.kinds[i] || '';
                    chatSlotProps['mt' + i] = worker.texts[i] || '';
                  }
                  return (
                    <Canvas.Node
                      key={worker.id}
                      gx={worker.gx}
                      gy={worker.gy}
                      gw={worker.gw}
                      gh={worker.gh}
                      onMove={(e: any) => updateWorkerState(worker.id, (w) => ({ ...w, gx: e.gx, gy: e.gy }))}
                    >
                      <Box
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: 'theme:radiusLg',
                          borderWidth: isSelected ? 2 : 1,
                          borderColor: isSelected ? selectionColor : '#243041',
                          backgroundColor: isSelected ? 'rgba(125,211,252,0.04)' : 'transparent',
                          shadowColor: isSelected ? selectionColor : 'transparent',
                          shadowBlur: isSelected ? 16 : 0,
                          shadowOffsetY: isSelected ? 1 : 0,
                        }}
                      >
                        <ChatFrame
                          msgCount={worker.msgCount}
                          {...chatSlotProps}
                          isStreaming={worker.isStreaming}
                          isConnecting={worker.isConnecting}
                        turnText={worker.turnText}
                        costText={worker.costText}
                        quest={worker.quest}
                        onRejectQuestStep={(stepId: string) => rejectWorkerQuestStep(worker.id, stepId)}
                        onAddQuestStep={(text: string) => addWorkerQuestStep(worker.id, text)}
                        backendLabel={backendDisplayName(selectedOrActiveBackend)}
                          backendLetter={backendLetter(selectedOrActiveBackend)}
                          modelLabel={modelLabel}
                          selectedVariant={worker.selectedVariant}
                          onSelectVariant={(variantId: string) => selectWorkerVariant(worker.id, variantId)}
                          selectedEffort={worker.selectedEffort}
                          onSelectEffort={(effort: string) => {
                            focusWorkerById(worker.id);
                            updateWorkerState(worker.id, (current) => ({ ...current, selectedEffort: effort }));
                          }}
                          selectedContext={worker.selectedContext}
                          onSelectContext={(ctx: string) => selectWorkerContext(worker.id, ctx)}
                          showSpawnMenu={worker.spawnMenuOpen}
                          onToggleSpawnMenu={() => toggleWorkerSpawnMenu(worker.id)}
                          spawnStatusText={spawnStatusText}
                          onSpawnClaudeOpus={() => spawnPreset(worker.id, 'claude', 'claude-opus-4-7')}
                          onSpawnClaudeSonnet={() => spawnPreset(worker.id, 'claude', 'claude-sonnet-4-6')}
                          onSpawnClaudeHaiku={() => spawnPreset(worker.id, 'claude', 'claude-haiku-4-5')}
                          onSpawnKimiK25={() => spawnPreset(worker.id, 'kimi', 'kimi-code/kimi-for-coding')}
                          onSpawnKimiK2={() => spawnPreset(worker.id, 'kimi', 'kimi-code/kimi-for-coding')}
                          onSpawnKimiThinking={() => spawnPreset(worker.id, 'kimi', 'kimi-code/kimi-for-coding')}
                          onSpawnGpt5Codex={() => announceUnavailable(worker.id, 'OpenAI', 'gpt-5-codex')}
                          onSpawnGpt54={() => announceUnavailable(worker.id, 'OpenAI', 'gpt-5.4')}
                          onSpawnGpt54Mini={() => announceUnavailable(worker.id, 'OpenAI', 'gpt-5.4-mini')}
                          onSpawnGeminiPro={() => announceUnavailable(worker.id, 'Gemini', 'gemini-2.5-pro')}
                          onSpawnGeminiFlash={() => announceUnavailable(worker.id, 'Gemini', 'gemini-2.5-flash')}
                          onSpawnGeminiFlashLite={() => announceUnavailable(worker.id, 'Gemini', 'gemini-2.5-flash-lite')}
                          onSpawnCodexLegacy={() => announceUnavailable(worker.id, 'OpenAI', 'codex')}
                        />
                      </Box>
                    </Canvas.Node>
                  );
                })}
                <Canvas.Clamp>
                  <Box style={{ flexDirection: 'column', width: '100%', height: '100%' }}>
                    <Box style={{ flexDirection: 'row', flexGrow: 1, flexBasis: 0 }}>
                      <C.RaidColumn>
                        <C.RaidHeader>
                          <C.RaidHeaderText>raid · agents</C.RaidHeaderText>
                        </C.RaidHeader>
                        {workers.map((worker) => {
                          const selectedOrActiveBackend = worker.activeBackend || worker.selectedBackend;
                          const selectedOrActiveModel = worker.activeModel || worker.selectedModel;
                          return (
                            <RaidFrame
                              key={worker.id}
                              active={activeWorkerId === worker.id ? 1 : 0}
                              online={worker.initState === 1 ? 1 : 0}
                              name={worker.label}
                              meta={selectedOrActiveModel || 'unassigned'}
                              classLetter={backendLetter(selectedOrActiveBackend)}
                              classColor={backendColor(selectedOrActiveBackend)}
                              hpPct={worker.initState === 1 ? 90 : worker.initState === 2 ? 12 : 50}
                              powerPct={worker.isStreaming === 1 ? 100 : 12}
                              role={worker.isStreaming === 1 ? 'streaming' : worker.initState === 1 ? 'ready' : worker.initState === 2 ? 'error' : 'idle'}
                              stat={worker.turnText}
                              onPress={() => focusWorkerById(worker.id)}
                            />
                          );
                        })}
                        <RaidFrameEmpty label="worker" onPress={createWorkerCard} />
                      </C.RaidColumn>
                      <Box style={{ flexGrow: 1, flexBasis: 0 }} />
                      <C.QuestColumn>
                        <C.QuestHeader>
                          <C.QuestHeaderText>quest log</C.QuestHeaderText>
                        </C.QuestHeader>
                        <QuestCard
                          title="Ship the cockpit QuestLog tile"
                          state={2}
                          doneCount={6}
                          totalSteps={8}
                          partyCount={2}
                          expanded={expandedQuestId === 'quest-log-tile' ? 1 : 0}
                          onPress={() => setExpandedQuestId(expandedQuestId === 'quest-log-tile' ? '' : 'quest-log-tile')}
                          s0_state={6} s0_text="Define the sqlite schema"
                          s1_state={6} s1_text="Write the markdown-to-db ingester"
                          s2_state={6} s2_text="Add QuestLog classifiers"
                          s3_state={6} s3_text="Create QuestLog.c.tsz"
                          s4_state={6} s4_text="Wire QuestLog into the cockpit"
                          s5_state={6} s5_text="Add expand/collapse state"
                          s6_state={2} s6_text="Read live data from sqlite"
                          s7_state={1} s7_text="Postflight end-to-end"
                        />
                        <QuestCard
                          title="Wire real audit-gate transitions"
                          state={1}
                          doneCount={0}
                          totalSteps={5}
                          partyCount={0}
                          expanded={expandedQuestId === 'audit-gate-pips' ? 1 : 0}
                          onPress={() => setExpandedQuestId(expandedQuestId === 'audit-gate-pips' ? '' : 'audit-gate-pips')}
                          s0_state={1} s0_text="Materialize verify.sh per step"
                          s1_state={1} s1_text="Add a verify-runner daemon hook"
                          s2_state={1} s2_text="Wire planner re-investigation"
                          s3_state={1} s3_text="Surface rejects in the law ticker"
                          s4_state={1} s4_text="Re-render cockpit on state saves"
                        />
                      </C.QuestColumn>
                    </Box>
                    <C.ActionBar>
                      {ACTIONS.map((a) => (
                        <ActionSlot
                          key={a.slot}
                          slot={a.slot}
                          glyph={a.glyph}
                          label={a.label}
                          tooltip={a.tooltip}
                          flash={actionFlash}
                          onPress={() => primeAction(a.slot)}
                        />
                      ))}
                    </C.ActionBar>
                    <C.TermInputBar>
                      <C.TermInputPrompt>❯</C.TermInputPrompt>
                      <TextInput
                        placeholder={inputPlaceholder}
                        value={draft}
                        onChangeText={(t: string) => setDraft(t)}
                        onSubmit={() => handleChatInput(draft)}
                        style={{ flexGrow: 1, flexBasis: 0, fontSize: 14, color: '#e2e8f0' }}
                      />
                      <C.ThemeButton onPress={() => handleChatInput(draft)}>
                        <C.ThemeButtonLabel>send</C.ThemeButtonLabel>
                      </C.ThemeButton>
                    </C.TermInputBar>
                  </Box>
                </Canvas.Clamp>
              </Canvas>
            </C.PageCanvasWrap>
          </C.Page>
        </C.Shell>
        <C.BottomBar>
          <C.BarLabel>cockpit</C.BarLabel>
          <C.Spacer />
          <C.BarLabel>{bottomTurnText}</C.BarLabel>
          <C.BarLabel>{bottomCostText}</C.BarLabel>
          <C.Spacer />
          <C.ThemeButton onPress={() => setActiveTheme(nextTheme)}>
            <C.ThemeButtonLabel>{THEME_NAMES[activeTheme]}</C.ThemeButtonLabel>
          </C.ThemeButton>
        </C.BottomBar>
      </C.Root>
    </ThemeProvider>
  );
}
