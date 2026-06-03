// ai_edit_loop_lab — test cart for the per-change AI edit loop.
//
// The pattern under test: instead of letting the model write one big
// patch against a subject, force it to emit one single-field change
// at a time as a streamed tool call. Each change shows up as a card
// in a live feed with [accept] / [reject]. Some changes can declare
// a parent — they nest under it and orphan when the parent is
// rejected. The user keeps the changes they want and drops the ones
// they don't, without throwing away the rest of the batch.
//
// The subject is a small parametric house (stand-in for an
// hmsc-int model). Accepted changes mutate its fields the moment
// the button is pressed.
//
// Two backends, toggle in the header:
//
//   - mock — deterministic keyword-matched plan emitted on a timer.
//            Offline, instant, useful for iterating on the loop UX.
//
//   - live — useAssistant({backend:'openai_compat', baseUrl:bridge})
//            hits claudewrap's bridge so the model is real claude
//            (free under the Max subscription, no API tokens). Each
//            tool_call the model emits becomes a change card. The
//            handler returns the new card's id so the model can pass
//            it as `depends_on` in subsequent calls to chain.
//
// ship: ./scripts/ship ai_edit_loop_lab

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Col, Text, Pressable, ScrollView, TextInput } from '@reactjit/primitives';
import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';

// ── Subject: a parametric house ────────────────────────────────────────────

type RoofShape = 'flat' | 'gable' | 'hip';

interface HouseState {
  wallColor: string;
  roofColor: string;
  doorColor: string;
  windowColor: string;
  trimColor: string;
  windowCount: number;       // windows per band, 1..6
  windowBands: number;       // 1..2 horizontal bands
  roofShape: RoofShape;
  scale: number;             // 0.6..1.4
}

const INITIAL_HOUSE: HouseState = {
  wallColor:   '#d8c9a8',
  roofColor:   '#7a4e3a',
  doorColor:   '#5a3826',
  windowColor: '#a7c5d6',
  trimColor:   '#3a2a1f',
  windowCount: 3,
  windowBands: 1,
  roofShape:   'gable',
  scale:       1.0,
};

type HouseField = keyof HouseState;

function HousePreview({ house }: { house: HouseState }) {
  const W = 320 * house.scale;
  const wallH = 180 * house.scale;
  const roofH = house.roofShape === 'flat' ? 10
              : house.roofShape === 'hip'  ? 36 * house.scale
              :                              66 * house.scale;
  const roofInset = house.roofShape === 'hip' ? 24 * house.scale : 0;
  const doorW = 42 * house.scale;
  const doorH = 70 * house.scale;
  const windowW = Math.max(18, (W - 48) / (house.windowCount * 1.6)) * 0.6;
  const windowH = windowW * 1.1;
  const bandGap = 14 * house.scale;

  const windows: { x: number; y: number; w: number; h: number }[] = [];
  for (let b = 0; b < house.windowBands; b++) {
    const bandY = 32 + b * (windowH + bandGap);
    const slotW = (W - 32) / house.windowCount;
    for (let i = 0; i < house.windowCount; i++) {
      const cx = 16 + slotW * i + slotW / 2;
      windows.push({ x: cx - windowW / 2, y: bandY, w: windowW, h: windowH });
    }
  }

  return (
    <Box style={{ width: W, height: wallH + roofH + 8, position: 'relative' }}>
      <Box style={{
        position: 'absolute', left: roofInset, top: 0,
        width: W - roofInset * 2, height: roofH,
        backgroundColor: house.roofColor,
        borderTopLeftRadius: house.roofShape === 'flat' ? 0 : 6,
        borderTopRightRadius: house.roofShape === 'flat' ? 0 : 6,
      }} />
      <Box style={{
        position: 'absolute', left: 0, top: roofH,
        width: W, height: 4,
        backgroundColor: house.trimColor,
      }} />
      <Box style={{
        position: 'absolute', left: 0, top: roofH + 4,
        width: W, height: wallH,
        backgroundColor: house.wallColor,
      }} />
      {windows.map((w, i) => (
        <Box key={`win-${i}`} style={{
          position: 'absolute',
          left: w.x, top: roofH + 4 + w.y,
          width: w.w, height: w.h,
          backgroundColor: house.windowColor,
          borderColor: house.trimColor,
          borderWidth: 2,
        }} />
      ))}
      <Box style={{
        position: 'absolute',
        left: (W - doorW) / 2,
        top: roofH + 4 + wallH - doorH,
        width: doorW, height: doorH,
        backgroundColor: house.doorColor,
        borderColor: house.trimColor,
        borderWidth: 2,
      }} />
    </Box>
  );
}

// ── Change proposals ───────────────────────────────────────────────────────

type ChangeStatus = 'streaming' | 'pending' | 'accepted' | 'rejected' | 'orphaned';

interface ChangeProposal {
  id: string;
  parentId?: string;
  field: HouseField;
  before: any;          // captured at proposal time (current applied value)
  next: any;            // proposed value
  rationale: string;    // short reason from the model
  status: ChangeStatus;
  depth: number;        // nesting level computed once at emit
}

function fieldLabel(f: HouseField): string {
  switch (f) {
    case 'wallColor':   return 'wall color';
    case 'roofColor':   return 'roof color';
    case 'doorColor':   return 'door color';
    case 'windowColor': return 'window color';
    case 'trimColor':   return 'trim color';
    case 'windowCount': return 'windows per band';
    case 'windowBands': return 'window bands';
    case 'roofShape':   return 'roof shape';
    case 'scale':       return 'scale';
  }
}

function isColorField(f: HouseField): boolean {
  return f === 'wallColor' || f === 'roofColor' || f === 'doorColor'
      || f === 'windowColor' || f === 'trimColor';
}

// ── Live mode: tools schema + dispatcher ───────────────────────────────────
//
// One tool per editable field. Each takes a value, a one-line rationale
// the user reads on the change card, and an optional depends_on carrying
// the change_id of a prior call to chain it (parent rejection orphans
// the children). After a successful tool call the dispatcher responds
// with `{ok:true, change_id:"c-N"}` so the model can pass that id as
// depends_on next time.

const DEFAULT_BRIDGE_URL = 'http://localhost:7781/v1';

// Bridge accepts any non-empty key since it's the local OpenAI-compat
// front for the user's already-authenticated claude subprocess.
const BRIDGE_API_KEY = 'bridge';

const TOOL_NAME_TO_FIELD: Record<string, HouseField> = {
  set_wall_color:   'wallColor',
  set_roof_color:   'roofColor',
  set_door_color:   'doorColor',
  set_window_color: 'windowColor',
  set_trim_color:   'trimColor',
  set_window_count: 'windowCount',
  set_window_bands: 'windowBands',
  set_roof_shape:   'roofShape',
  set_scale:        'scale',
};

interface ToolDef {
  name: string;
  description: string;
  valueSchema: any;        // JSON Schema fragment for the `value` property
}

const TOOL_DEFS: ToolDef[] = [
  { name: 'set_wall_color',   description: 'Set the house wall colour. Hex e.g. "#d8c9a8".',  valueSchema: { type: 'string' } },
  { name: 'set_roof_color',   description: 'Set the roof colour. Hex e.g. "#7a4e3a".',         valueSchema: { type: 'string' } },
  { name: 'set_door_color',   description: 'Set the door colour. Hex e.g. "#5a3826".',         valueSchema: { type: 'string' } },
  { name: 'set_window_color', description: 'Set the window-pane tint. Hex e.g. "#a7c5d6".',    valueSchema: { type: 'string' } },
  { name: 'set_trim_color',   description: 'Set the trim/eave colour. Hex e.g. "#3a2a1f".',    valueSchema: { type: 'string' } },
  { name: 'set_window_count', description: 'Set windows per band, 1..6.',                       valueSchema: { type: 'integer', minimum: 1, maximum: 6 } },
  { name: 'set_window_bands', description: 'Set the number of horizontal window bands, 1..2.', valueSchema: { type: 'integer', minimum: 1, maximum: 2 } },
  { name: 'set_roof_shape',   description: 'Set roof shape: "flat", "gable", or "hip".',       valueSchema: { type: 'string', enum: ['flat', 'gable', 'hip'] } },
  { name: 'set_scale',        description: 'Set overall house scale, 0.6..1.4.',                valueSchema: { type: 'number', minimum: 0.6, maximum: 1.4 } },
];

function buildToolsSchema(): string {
  return JSON.stringify(TOOL_DEFS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: {
          value: t.valueSchema,
          rationale: {
            type: 'string',
            description: 'One-line reason the user can read on the change card.',
          },
          depends_on: {
            type: 'string',
            description:
              'Optional change_id of a PRIOR tool call this change depends on. ' +
              'Read it from the previous tool result. The user can reject a parent ' +
              'to orphan all its children at once.',
          },
        },
        required: ['value', 'rationale'],
      },
    },
  })));
}

const LIVE_SYSTEM_PROMPT =
  "You edit a small parametric house by emitting ONE tool call per change. " +
  "Each tool sets a single field of the house. NEVER bundle multiple changes " +
  "into one tool call — emit a separate call for every field you want to touch. " +
  "Each tool result returns { ok: true, change_id: \"c-N\" }. If your next " +
  "change only makes sense in light of one you just made, pass that prior " +
  "change_id as `depends_on`. The user accepts or rejects each card; rejecting " +
  "a parent orphans every change that depended on it. Always include a short " +
  "human-readable `rationale` so the user knows why you suggested it. After " +
  "your chain of tool calls, end the turn — no prose.";

// ── Mock generator ─────────────────────────────────────────────────────────
//
// Reads the prompt for a few keywords, picks one of a handful of curated
// edit chains, and emits them one at a time over ~3 seconds. Each step
// optionally references the previous step as its parent so the UI shows
// dependency nesting and parent-rejection orphaning.

interface MockStep {
  field: HouseField;
  next: any;
  rationale: string;
  chainTo?: number;     // index of a prior step this depends on
}

function planForPrompt(prompt: string): MockStep[] {
  const p = prompt.toLowerCase();
  if (p.includes('cozy') || p.includes('warm') || p.includes('autumn')) {
    return [
      { field: 'wallColor',   next: '#c98b54', rationale: 'warm terracotta walls' },
      { field: 'roofColor',   next: '#5a2e1d', rationale: 'deep burnt umber roof', chainTo: 0 },
      { field: 'trimColor',   next: '#2e1a0f', rationale: 'darker trim to ground the warm tones', chainTo: 1 },
      { field: 'windowColor', next: '#f1c27d', rationale: 'glowing amber windows' },
      { field: 'doorColor',   next: '#7a3a1a', rationale: 'matching reddish door' },
    ];
  }
  if (p.includes('modern') || p.includes('minimal') || p.includes('clean')) {
    return [
      { field: 'wallColor',   next: '#ececec', rationale: 'crisp white walls' },
      { field: 'roofShape',   next: 'flat',     rationale: 'flat modernist roof' },
      { field: 'roofColor',   next: '#2a2a2a', rationale: 'matte charcoal roof slab', chainTo: 1 },
      { field: 'trimColor',   next: '#1a1a1a', rationale: 'black trim accent', chainTo: 2 },
      { field: 'windowCount', next: 4,          rationale: 'broader fenestration' },
      { field: 'doorColor',   next: '#1a1a1a', rationale: 'matching black door' },
    ];
  }
  if (p.includes('spook') || p.includes('haunt') || p.includes('creepy')) {
    return [
      { field: 'wallColor',   next: '#3a3540', rationale: 'pallid stone walls' },
      { field: 'roofColor',   next: '#0e0c12', rationale: 'pitch-black roof' },
      { field: 'roofShape',   next: 'gable',    rationale: 'sharp gable peak', chainTo: 1 },
      { field: 'windowColor', next: '#e0d066', rationale: 'sickly yellow windows' },
      { field: 'doorColor',   next: '#1e1218', rationale: 'rotting wood door' },
      { field: 'trimColor',   next: '#0a0a0c', rationale: 'inky trim to deepen shadows' },
    ];
  }
  if (p.includes('big') || p.includes('larger') || p.includes('grow')) {
    return [
      { field: 'scale',       next: 1.3,        rationale: 'scale up the whole structure' },
      { field: 'windowCount', next: 5,          rationale: 'more windows to fill the wider walls', chainTo: 0 },
      { field: 'windowBands', next: 2,          rationale: 'add a second-storey band of windows', chainTo: 1 },
    ];
  }
  if (p.includes('windows')) {
    return [
      { field: 'windowCount', next: 5,          rationale: 'more windows per band' },
      { field: 'windowBands', next: 2,          rationale: 'second band for a taller house', chainTo: 0 },
      { field: 'windowColor', next: '#cfe9ff', rationale: 'brighter pane tint' },
    ];
  }
  if (p.includes('roof')) {
    return [
      { field: 'roofShape',   next: 'hip',      rationale: 'hipped roof for a classical look' },
      { field: 'roofColor',   next: '#4a3a2a', rationale: 'matched warm brown', chainTo: 0 },
      { field: 'trimColor',   next: '#241a12', rationale: 'darker eave trim', chainTo: 1 },
    ];
  }
  let seed = 0;
  for (let i = 0; i < prompt.length; i++) seed = (seed * 31 + prompt.charCodeAt(i)) >>> 0;
  const palettes = [
    ['#a8c5a1', '#3a4e2a', '#1e2a14', '#dde9d4', '#2a3a1f'],
    ['#c0a8d8', '#4a2e6e', '#1e1230', '#e7d4f0', '#2a1840'],
    ['#a8c0d8', '#2e4a6e', '#142030', '#d0e0f0', '#1a2840'],
  ];
  const pal = palettes[seed % palettes.length];
  return [
    { field: 'wallColor',   next: pal[0], rationale: 'fresh wall tone' },
    { field: 'roofColor',   next: pal[1], rationale: 'complementary roof', chainTo: 0 },
    { field: 'trimColor',   next: pal[2], rationale: 'deeper trim', chainTo: 1 },
    { field: 'windowColor', next: pal[3], rationale: 'softer window tint' },
    { field: 'doorColor',   next: pal[4], rationale: 'matching door' },
  ];
}

interface StreamHandle { cancel(): void; }

function runMockProposalStream(
  prompt: string,
  applied: () => HouseState,
  onProposal: (p: ChangeProposal) => void,
  onDone: () => void,
): StreamHandle {
  const plan = planForPrompt(prompt);
  const stepDelayMs = 650;
  let cancelled = false;
  let i = 0;
  const emittedIds: string[] = [];
  const emittedDepth: number[] = [];

  const sched = (fn: () => void, ms: number) =>
    (globalThis as any).setTimeout
      ? (globalThis as any).setTimeout(fn, ms)
      : (fn(), 0);

  const tick = () => {
    if (cancelled) return;
    if (i >= plan.length) { onDone(); return; }
    const step = plan[i];
    const id = `c-${Date.now().toString(36)}-${i}`;
    const parentId = step.chainTo != null ? emittedIds[step.chainTo] : undefined;
    const depth = parentId ? emittedDepth[step.chainTo!] + 1 : 0;
    emittedIds.push(id);
    emittedDepth.push(depth);
    const before = applied()[step.field];
    onProposal({
      id, parentId,
      field: step.field,
      before,
      next: step.next,
      rationale: step.rationale,
      status: 'pending',
      depth,
    });
    i += 1;
    sched(tick, stepDelayMs);
  };

  sched(tick, 250);
  return { cancel() { cancelled = true; onDone(); } };
}

// ── UI atoms ───────────────────────────────────────────────────────────────

const PALETTE = {
  bg:        '#13161c',
  panel:     '#1c2029',
  panelEdge: '#2a2f3a',
  text:      '#e7ebf2',
  dim:       '#7f8896',
  accent:    '#7ab8ff',
  good:      '#7adf9d',
  bad:       '#ef7a7a',
  warn:      '#e3b86a',
};

function Swatch({ value, size = 18 }: { value: any; size?: number }) {
  if (typeof value === 'string' && value.startsWith('#')) {
    return (
      <Box style={{
        width: size, height: size,
        backgroundColor: value,
        borderColor: '#000', borderWidth: 1,
      }} />
    );
  }
  return (
    <Box style={{
      paddingLeft: 6, paddingRight: 6,
      paddingTop: 1, paddingBottom: 1,
      backgroundColor: PALETTE.panelEdge,
    }}>
      <Text style={{ color: PALETTE.text, fontSize: 12, fontFamily: 'mono' }}>{String(value)}</Text>
    </Box>
  );
}

function StatusChip({ status }: { status: ChangeStatus }) {
  const color =
    status === 'accepted' ? PALETTE.good :
    status === 'rejected' ? PALETTE.bad :
    status === 'orphaned' ? PALETTE.warn :
    PALETTE.dim;
  const label =
    status === 'accepted' ? 'accepted' :
    status === 'rejected' ? 'rejected' :
    status === 'orphaned' ? 'orphaned' :
    status === 'streaming' ? 'streaming' : 'pending';
  return (
    <Box style={{
      paddingLeft: 6, paddingRight: 6,
      paddingTop: 1, paddingBottom: 1,
      borderColor: color, borderWidth: 1,
    }}>
      <Text style={{ color, fontSize: 11, fontFamily: 'mono' }}>{label}</Text>
    </Box>
  );
}

function PressableButton({
  label, onPress, tone = 'neutral', disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'good' | 'bad' | 'neutral';
  disabled?: boolean;
}) {
  const tint = tone === 'good' ? PALETTE.good : tone === 'bad' ? PALETTE.bad : PALETTE.accent;
  return (
    <Pressable onPress={disabled ? () => {} : onPress}>
      <Box style={{
        paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
        backgroundColor: disabled ? PALETTE.panel : '#0e1116',
        borderColor: disabled ? PALETTE.panelEdge : tint,
        borderWidth: 1,
        opacity: disabled ? 0.5 : 1.0,
      }}>
        <Text style={{ color: disabled ? PALETTE.dim : tint, fontSize: 12, fontFamily: 'mono' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

// ── Change card ────────────────────────────────────────────────────────────

function ChangeCard({
  change,
  onAccept,
  onReject,
}: {
  change: ChangeProposal;
  onAccept: () => void;
  onReject: () => void;
}) {
  const indent = change.depth * 18;
  const resolved = change.status !== 'pending' && change.status !== 'streaming';
  const edgeColor =
    change.status === 'accepted' ? PALETTE.good :
    change.status === 'rejected' ? PALETTE.bad :
    change.status === 'orphaned' ? PALETTE.warn :
    change.parentId ? PALETTE.accent : PALETTE.panelEdge;
  return (
    <Box style={{ marginLeft: indent, marginBottom: 6 }}>
      <Box style={{
        backgroundColor: PALETTE.panel,
        borderColor: edgeColor,
        borderWidth: 1,
        padding: 8,
      }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ color: PALETTE.dim, fontSize: 11, fontFamily: 'mono' }}>
            {change.parentId ? '↳ ' : ''}set_{change.field}
          </Text>
          <Box style={{ flexGrow: 1 }} />
          <StatusChip status={change.status} />
        </Row>
        <Row style={{ alignItems: 'center', gap: 6, marginTop: 6 }}>
          <Swatch value={change.before} />
          <Text style={{ color: PALETTE.dim, fontSize: 12, fontFamily: 'mono' }}>→</Text>
          <Swatch value={change.next} />
          <Box style={{ width: 8 }} />
          <Text style={{ color: PALETTE.text, fontSize: 12 }}>{fieldLabel(change.field)}</Text>
        </Row>
        <Text style={{ color: PALETTE.dim, fontSize: 12, marginTop: 6 }}>{change.rationale}</Text>
        {!resolved ? (
          <Row style={{ gap: 6, marginTop: 8 }}>
            <PressableButton label="accept" tone="good" onPress={onAccept} />
            <PressableButton label="reject" tone="bad"  onPress={onReject} />
          </Row>
        ) : null}
      </Box>
    </Box>
  );
}

// ── Main cart ──────────────────────────────────────────────────────────────

type Mode = 'mock' | 'live';

export default function AiEditLoopLab() {
  const [mode, setMode] = useState<Mode>('mock');
  const [bridgeUrl, setBridgeUrl] = useState<string>(DEFAULT_BRIDGE_URL);

  const [house, setHouse] = useState<HouseState>(INITIAL_HOUSE);
  const [changes, setChanges] = useState<ChangeProposal[]>([]);
  const [prompt, setPrompt] = useState('');
  const [streaming, setStreaming] = useState(false);
  const mockStreamRef = useRef<StreamHandle | null>(null);

  // Live ref so the mock generator AND the live dispatcher capture the
  // latest committed house when stamping a proposal's `before` field.
  const houseRef = useRef(house);
  houseRef.current = house;

  // Mirror changes into a ref so the dispatcher can look up depth-of-parent
  // when stamping a child change without re-rendering on every event.
  const changesRef = useRef(changes);
  changesRef.current = changes;

  // ── Live assistant — openai_compat → claudewrap bridge ───────────────────
  //
  // backend is undefined in mock mode → the hook stays in 'init' and
  // never spawns a worker. Flipping the mode chip flips backend, which
  // respawns the worker (we key off bridgeUrl too so editing the URL
  // restarts cleanly).
  const toolsJson = useMemo(buildToolsSchema, []);
  const assistant = useAssistant({
    backend: mode === 'live' ? 'openai_compat' : undefined,
    baseUrl: bridgeUrl,
    apiKey: BRIDGE_API_KEY,
    systemPrompt: LIVE_SYSTEM_PROMPT,
    tools: toolsJson,
    model: 'disk-claude',
    persistAcrossUnmount: false,
  });

  // ── Live tool dispatcher ────────────────────────────────────────────────
  //
  // Walk new events; for each tool_call, build a ChangeProposal, push it
  // into the feed, and respond to the worker so the model gets back a
  // `change_id` string it can use as depends_on in the next call.
  const liveCursorRef = useRef(0);
  const liveEmittedRef = useRef(0);
  useEffect(() => {
    if (mode !== 'live') {
      // Keep the cursor abreast so we don't replay everything when the
      // user flips back to live.
      liveCursorRef.current = assistant.events.length;
      return;
    }
    const events = assistant.events;
    if (events.length <= liveCursorRef.current) return;
    for (let i = liveCursorRef.current; i < events.length; i += 1) {
      const ev = events[i];
      if (ev.kind === 'completion' || ev.kind === 'error_') {
        setStreaming(false);
        continue;
      }
      if (ev.kind !== 'tool_call') continue;
      const payload = parseToolCallEvent(ev.payload_json);
      if (!payload) continue;
      const field = TOOL_NAME_TO_FIELD[payload.name];
      if (!field) {
        assistant.respond(payload.id, JSON.stringify({
          ok: false, error: `unknown tool: ${payload.name}`,
        }));
        continue;
      }
      let args: any = {};
      try { args = JSON.parse(payload.input_json); } catch { /* malformed; surface */ }
      if (args.value === undefined) {
        assistant.respond(payload.id, JSON.stringify({
          ok: false, error: 'value is required',
        }));
        continue;
      }
      const idx = liveEmittedRef.current++;
      const changeId = `c-${Date.now().toString(36)}-${idx}`;
      const parentId = typeof args.depends_on === 'string' && args.depends_on
        ? args.depends_on
        : undefined;
      // depth from parent if present
      let depth = 0;
      if (parentId) {
        const parent = changesRef.current.find((c) => c.id === parentId);
        if (parent) depth = parent.depth + 1;
      }
      const before = houseRef.current[field];
      const proposal: ChangeProposal = {
        id: changeId, parentId,
        field,
        before,
        next: args.value,
        rationale: typeof args.rationale === 'string' ? args.rationale : '(no rationale provided)',
        status: 'pending',
        depth,
      };
      setChanges((cs) => [...cs, proposal]);
      assistant.respond(payload.id, JSON.stringify({
        ok: true,
        change_id: changeId,
        hint: 'Pass this change_id as depends_on if your next change builds on this one.',
      }));
    }
    liveCursorRef.current = events.length;
  }, [assistant.events, mode]);

  // Mirror assistant phase into the local streaming flag for the live mode.
  useEffect(() => {
    if (mode !== 'live') return;
    if (assistant.phase === 'streaming') setStreaming(true);
    else if (assistant.phase === 'idle' || assistant.phase === 'failed' || assistant.phase === 'closed') {
      setStreaming(false);
    }
  }, [assistant.phase, mode]);

  // ── Send / cancel ───────────────────────────────────────────────────────

  const startStream = () => {
    const text = prompt.trim();
    if (!text || streaming) return;
    setStreaming(true);
    if (mode === 'mock') {
      mockStreamRef.current?.cancel();
      mockStreamRef.current = runMockProposalStream(
        text,
        () => houseRef.current,
        (proposal) => setChanges((cs) => [...cs, proposal]),
        () => setStreaming(false),
      );
    } else {
      const ok = assistant.ask(text);
      if (!ok) {
        setStreaming(false);
      }
    }
  };

  const cancelStream = () => {
    if (mode === 'mock') {
      mockStreamRef.current?.cancel();
      mockStreamRef.current = null;
    } else {
      assistant.close();
    }
    setStreaming(false);
  };

  useEffect(() => () => { mockStreamRef.current?.cancel(); }, []);

  // ── Accept / reject ─────────────────────────────────────────────────────

  const acceptChange = (id: string) => {
    const target = changes.find((c) => c.id === id);
    if (!target || target.status !== 'pending') return;
    setChanges((cs) => cs.map((c) =>
      c.id === id && c.status === 'pending' ? { ...c, status: 'accepted' } : c,
    ));
    setHouse((h) => ({ ...h, [target.field]: target.next } as HouseState));
  };

  const rejectChange = (id: string) => {
    setChanges((cs) => {
      const dropped = new Set<string>([id]);
      for (const c of cs) {
        if (c.parentId && dropped.has(c.parentId)) dropped.add(c.id);
      }
      return cs.map((c) => {
        if (!dropped.has(c.id)) return c;
        if (c.status !== 'pending' && c.status !== 'streaming') return c;
        return { ...c, status: c.id === id ? 'rejected' : 'orphaned' };
      });
    });
  };

  const resetHouse = () => {
    cancelStream();
    setHouse(INITIAL_HOUSE);
    setChanges([]);
  };

  const stats = useMemo(() => {
    let a = 0, r = 0, o = 0, p = 0;
    for (const c of changes) {
      if      (c.status === 'accepted') a++;
      else if (c.status === 'rejected') r++;
      else if (c.status === 'orphaned') o++;
      else                              p++;
    }
    return { a, r, o, p };
  }, [changes]);

  const liveStatus = mode === 'live'
    ? (assistant.error ? `error: ${assistant.error}` : assistant.phase)
    : '';

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: PALETTE.bg }}>
      <Row style={{ width: '100%', height: '100%' }}>

        {/* LEFT: prompt + change feed */}
        <Col style={{ flexGrow: 1, flexBasis: 0, height: '100%', padding: 12, gap: 10 }}>
          <Row style={{ alignItems: 'center', gap: 10 }}>
            <Text style={{ color: PALETTE.text, fontSize: 16 }}>AI edit loop · house lab</Text>
            <ModeToggle mode={mode} onChange={(m) => { cancelStream(); setMode(m); }} />
            <Box style={{ flexGrow: 1 }} />
            <Text style={{ color: PALETTE.dim, fontSize: 12, fontFamily: 'mono' }}>
              {stats.a} accepted · {stats.r} rejected · {stats.o} orphaned · {stats.p} pending
            </Text>
          </Row>

          {mode === 'live' ? (
            <Box style={{
              backgroundColor: PALETTE.panel,
              borderColor: PALETTE.panelEdge, borderWidth: 1,
              padding: 8,
            }}>
              <Row style={{ alignItems: 'center', gap: 8 }}>
                <Text style={{ color: PALETTE.dim, fontSize: 11, fontFamily: 'mono' }}>bridge</Text>
                <Box style={{
                  flexGrow: 1,
                  backgroundColor: '#0e1116',
                  borderColor: PALETTE.panelEdge, borderWidth: 1,
                  paddingLeft: 6, paddingRight: 6,
                  paddingTop: 4, paddingBottom: 4,
                }}>
                  <TextInput
                    value={bridgeUrl}
                    onChangeText={setBridgeUrl}
                    placeholder={DEFAULT_BRIDGE_URL}
                    style={{ color: PALETTE.text, fontSize: 12, fontFamily: 'mono' }}
                  />
                </Box>
                <Text style={{
                  color: assistant.error ? PALETTE.bad : assistant.phase === 'idle' || assistant.phase === 'streaming' ? PALETTE.good : PALETTE.warn,
                  fontSize: 11, fontFamily: 'mono',
                }}>
                  {liveStatus}
                </Text>
              </Row>
            </Box>
          ) : null}

          <Box style={{
            backgroundColor: PALETTE.panel,
            borderColor: PALETTE.panelEdge, borderWidth: 1,
            padding: 8,
          }}>
            <Text style={{ color: PALETTE.dim, fontSize: 11, fontFamily: 'mono', marginBottom: 4 }}>
              {mode === 'live'
                ? 'prompt — real claude via bridge. one tool call per change.'
                : 'prompt — try: "make it cozy", "modern minimal", "spooky", "more windows", "bigger"'}
            </Text>
            <Row style={{ alignItems: 'center', gap: 8 }}>
              <Box style={{
                flexGrow: 1,
                backgroundColor: '#0e1116',
                borderColor: PALETTE.panelEdge, borderWidth: 1,
                paddingLeft: 8, paddingRight: 8,
                paddingTop: 6, paddingBottom: 6,
              }}>
                <TextInput
                  value={prompt}
                  onChangeText={(t: string) => setPrompt(t)}
                  placeholder="describe a change…"
                  style={{ color: PALETTE.text, fontSize: 13 }}
                />
              </Box>
              {streaming ? (
                <PressableButton label="stop" tone="bad" onPress={cancelStream} />
              ) : (
                <PressableButton label="send" tone="neutral" onPress={startStream} disabled={prompt.trim().length === 0} />
              )}
              <PressableButton label="reset" tone="neutral" onPress={resetHouse} />
            </Row>
          </Box>

          <Box style={{ flexGrow: 1, flexBasis: 0 }}>
            <ScrollView style={{ width: '100%', height: '100%' }}>
              <Box style={{ padding: 2 }}>
                {changes.length === 0 ? (
                  <Box style={{
                    padding: 16,
                    backgroundColor: PALETTE.panel,
                    borderColor: PALETTE.panelEdge, borderWidth: 1,
                  }}>
                    <Text style={{ color: PALETTE.dim, fontSize: 13 }}>
                      No changes yet. Send a prompt — proposals stream in one at a time. Accept the ones you like, reject the rest; rejecting a parent orphans every change that depends on it.
                    </Text>
                  </Box>
                ) : null}
                {changes.map((c) => (
                  <ChangeCard
                    key={c.id}
                    change={c}
                    onAccept={() => acceptChange(c.id)}
                    onReject={() => rejectChange(c.id)}
                  />
                ))}
                {streaming ? (
                  <Box style={{ padding: 8, marginTop: 4 }}>
                    <Text style={{ color: PALETTE.dim, fontSize: 12, fontFamily: 'mono' }}>
                      ▮ streaming next proposal…
                    </Text>
                  </Box>
                ) : null}
              </Box>
            </ScrollView>
          </Box>
        </Col>

        {/* RIGHT: subject preview */}
        <Col style={{
          width: 420, height: '100%',
          backgroundColor: '#0e1116',
          borderLeftColor: PALETTE.panelEdge, borderLeftWidth: 1,
          padding: 16, gap: 10,
        }}>
          <Text style={{ color: PALETTE.text, fontSize: 14 }}>house · live</Text>
          <Box style={{
            flexGrow: 1, flexBasis: 0,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: '#202733',
            borderColor: PALETTE.panelEdge, borderWidth: 1,
          }}>
            <HousePreview house={house} />
          </Box>

          <Box style={{
            backgroundColor: PALETTE.panel,
            borderColor: PALETTE.panelEdge, borderWidth: 1,
            padding: 8,
          }}>
            <Text style={{ color: PALETTE.dim, fontSize: 11, fontFamily: 'mono', marginBottom: 6 }}>committed state</Text>
            {(Object.keys(house) as HouseField[]).map((k) => (
              <Row key={k} style={{ alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <Text style={{ color: PALETTE.dim, fontSize: 12, fontFamily: 'mono', width: 130 }}>{k}</Text>
                {isColorField(k) ? <Swatch value={house[k]} size={14} /> : null}
                <Text style={{ color: PALETTE.text, fontSize: 12, fontFamily: 'mono' }}>
                  {String(house[k])}
                </Text>
              </Row>
            ))}
          </Box>
        </Col>

      </Row>
    </Box>
  );
}

// ── ModeToggle chip ────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const cell = (label: Mode) => {
    const on = mode === label;
    return (
      <Pressable onPress={() => onChange(label)} key={label}>
        <Box style={{
          paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3,
          backgroundColor: on ? '#0e1116' : 'transparent',
          borderColor: on ? PALETTE.accent : 'transparent', borderWidth: 1,
        }}>
          <Text style={{ color: on ? PALETTE.accent : PALETTE.dim, fontSize: 11, fontFamily: 'mono' }}>
            {label}
          </Text>
        </Box>
      </Pressable>
    );
  };
  return (
    <Row style={{
      borderColor: PALETTE.panelEdge, borderWidth: 1,
      padding: 1, gap: 1,
    }}>
      {cell('mock')}
      {cell('live')}
    </Row>
  );
}

// ── Worker tool_call event payload ─────────────────────────────────────────

interface ToolCallEventPayload { id: string; name: string; input_json: string }

function parseToolCallEvent(payload_json: string | undefined): ToolCallEventPayload | null {
  if (!payload_json) return null;
  try {
    const obj = JSON.parse(payload_json);
    if (typeof obj?.id !== 'string' || typeof obj?.name !== 'string') return null;
    const input = typeof obj.input_json === 'string' ? obj.input_json : '{}';
    return { id: obj.id, name: obj.name, input_json: input };
  } catch {
    return null;
  }
}
