import type { DocIndex } from '../types';

export const editor_deej: DocIndex = {
  name: 'editor_deej',
  file: 'editor_deej.md',
  cart: 'cart/editor/shell/AppFrame.tsx',
  purpose: ['ui', 'input', 'interaction'],
  summary:
    'deej fader board → live brush (req_3085): a homemade Arduino fader mixer printing \'|\'-separated 10-bit values over USB serial drives brush size (fader 1) and flow (fader 2) while a paint surface is up. Movement-only contract — the host emits an event only when a fader physically crosses the jitter threshold vs its last emitted value, and the first line after connect is a silent baseline — so the on-screen sliders stay fully authoritative when the board is idle, unplugged, or absent (the user\'s stated fallback requirement IS the design).',
  interfaces: [
    {
      name: 'framework/deej.zig (serial fader-board reader)',
      purpose: ['input'],
      kind: 'utility',
      sourceFile: 'framework/deej.zig',
      description:
        'Plain POSIX serial host system — no ALSA, no MIDI, no native libs. Opens the port read-only non-blocking raw 8N1 (default 9600, the stock deej sketch rate), drains lines on poll(), queues {slider, value 0..1} per fader whose raw delta beats JITTER_RAW=4 vs the last EMITTED value (creep accumulates; 0/1023 endpoint touches always land). Port: explicit arg > RJIT_DEEJ_PORT env > /dev/ttyACM0-3 + ttyUSB0-3 scan (tcgetattr is the tty probe). Unplug → disconnected → ~1s rescan. 6 parser unit tests in-file (zig test framework/deej.zig).',
      dependsOn: [],
      consumers: ['framework/v8_bindings_deej.zig'],
      status: 'live',
    },
    {
      name: '__deej_* bindings + deej ingredient',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_deej.zig',
      description:
        '__deej_start(port?, baud?) / __deej_stop / __deej_is_available / __deej_poll / __deej_state_json / __deej_next_event_json. Ingredient "deej" (grep prefix __deej_) in v8_ingredients.zig, -Dhas-deej in build.zig, flipped source-driven by the useDeej import via sdk/dependency-registry.json (same door pattern as usePaintable).',
      dependsOn: ['framework/deej.zig'],
      consumers: ['runtime/hooks/useDeej.ts'],
      status: 'live',
    },
    {
      name: 'useDeej / subscribeDeej',
      purpose: ['ui', 'input'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/useDeej.ts',
      description:
        'The public one-line cart surface: useDeej() → {available, connected, port, values, subscribe}. Module-level 33ms drain timer; subscribeDeej(fn) for register-once consumers. No board = available true / connected false / zero events.',
      dependsOn: ['framework/v8_bindings_deej.zig'],
      consumers: ['cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'AppFrame deej→brush mapping',
      purpose: ['ui', 'interaction'],
      kind: 'component',
      sourceFile: 'cart/editor/shell/AppFrame.tsx',
      description:
        'One subscribeDeej registration into deejApplyRef; the ref is re-pointed each render next to setActivePaintBrush where the active paint context (facade vs model) is known. Fader 0 → brush.size (1..128, same range as the PaintToolbar slider), fader 1 → brush.flow (0.02..1). Gated on paintUiActive — outside a paint surface the board is inert. Faders 3-5 unmapped.',
      dependsOn: ['runtime/hooks/useDeej.ts', 'setActivePaintBrush'],
      consumers: [],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'movement-only physical-control contract',
      purpose: ['input', 'ui'],
      description:
        'Physical faders cannot be motorized, so board and UI always disagree at rest. The contract: hardware writes ONLY on physical movement (jitter-thresholded vs last emitted value), first line after connect is a silent baseline, UI stays authoritative otherwise. Reuse this for any future physical control surface (jog wheels, pedals) — never mirror UI state out to dumb hardware.',
      examples: ['editor_deej'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'serial is single-consumer',
      purpose: ['input'],
      severity: 'medium',
      description:
        'If the deej desktop volume app (or anything else) holds the same serial port, two readers steal bytes from each other and both see corrupt lines. Run one consumer at a time. Also: reading /dev/ttyACM* needs the dialout group or a udev rule — the user was NOT in dialout as of 2026-07-15.',
      evidence: ['docs/game/editor_deej.md "Open / next"', 'framework/deej.zig port scan'],
    },
  ],
};
