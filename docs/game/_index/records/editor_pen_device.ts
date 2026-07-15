import type { DocIndex } from '../types';

export const editor_pen_device: DocIndex = {
  name: 'editor_pen_device',
  file: 'editor_pen_device.md',
  cart: 'cart/editor/shell/AppFrame.tsx',
  purpose: ['ui', 'input', 'interaction'],
  summary:
    'Pen/mouse device awareness (req_3089): the host classifies every pointer event by its SDL device id (pen-synthesized mouse events carry SDL_PEN_MOUSEID), fires system:pointerDevice on the change edge (pen PROXIMITY hover counts — the flip lands before first contact), and feeds real SDL_PEN_AXIS_PRESSURE into every pointer payload (pointerType + pressure, web PointerEvent contract). The editor uses it GIMP-style: each device remembers the last tool it activated per surface scope, so the pen paints while the mouse pulls vertices with no manual toggle.',
  interfaces: [
    {
      name: 'engine pen classification + mouse_state device/pressure',
      purpose: ['input'],
      kind: 'utility',
      sourceFile: 'framework/engine.zig',
      description:
        'notePointerDevice(which) at the top of the MOUSE_MOTION/BUTTON_DOWN/BUTTON_UP cases (SDL_PEN_MOUSEID → pen, else mouse); new cases SDL_EVENT_PEN_PROXIMITY_IN (pre-switch on hover), PEN_DOWN/UP (assert pen, zero pressure on lift), PEN_AXIS (live pressure). State lives in framework/state/mouse_state.zig: g_pointer_device, g_pen_pressure, updatePointerDevice(dev)→changed. Pen→mouse synthesis is SDL3\'s default, so the whole existing mouse pipeline is untouched.',
      dependsOn: ['framework/state/mouse_state.zig'],
      consumers: ['framework/ifttt/system_signals.zig', 'framework/v8_bindings_core.zig'],
      status: 'live',
    },
    {
      name: 'getPointerDevice / getPenPressure + system:pointerDevice signal',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      description:
        'getPointerDevice() → 0 mouse | 1 pen; getPenPressure() → 0..1. system_signals.notifyPointerDevice evals __ifttt_onSystemPointerDevice(dev) on the change edge only → useIFTTT emits bus event system:pointerDevice { device, at }. getPointerPayload (runtime/index.tsx) reads both so every onPointer*/onMouse* payload carries pointerType and real pen pressure — useBrushStroke\'s existing e.pressure → pressureRadius path gets true Wacom pressure with zero paint-kit changes.',
      dependsOn: ['framework/state/mouse_state.zig'],
      consumers: ['runtime/index.tsx', 'runtime/hooks/useIFTTT.ts', 'runtime/hooks/usePointerDevice.ts'],
      status: 'live',
    },
    {
      name: 'usePointerDevice / getPointerDevice (JS)',
      purpose: ['ui', 'input'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/usePointerDevice.ts',
      description:
        'The public one-line cart surface: usePointerDevice() → \'mouse\' | \'pen\' (re-renders on flip via the system:pointerDevice subscription); getPointerDevice() for instant non-hook reads. Exported from runtime/hooks/index.ts.',
      dependsOn: ['framework/v8_bindings_core.zig'],
      consumers: ['cart/editor/shell/AppFrame.tsx'],
      status: 'live',
    },
    {
      name: 'AppFrame per-device tool memory',
      purpose: ['ui', 'interaction'],
      kind: 'component',
      sourceFile: 'cart/editor/shell/AppFrame.tsx',
      description:
        'runCommand stamps state.deviceTools[scope][device] on every TOOL command activation (command.tool, scope world|model, source ≠ \'device\'); a busOn(\'system:pointerDevice\') subscription next to runCommandRef replays the incoming device\'s remembered tool for the surface in view (source \'device\'). lastToolByScopeRef dedupes so an unchanged tool never re-fires (re-dispatch would EXIT toggle-style mesh tools); commandById guards slots persisted across code updates. deviceTools rides EditorState → the persistView hot twig: survives dev reloads, resets cold.',
      dependsOn: ['runtime/hooks/usePointerDevice.ts', 'runtime/hooks/useIFTTT.ts'],
      consumers: [],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'per-device tool memory (GIMP device contract)',
      purpose: ['input', 'ui'],
      description:
        'Each physical input device remembers its own tool; a device change RESTORES, never resets. Slots start empty and populate as each device picks tools, so nothing auto-switches until the user has taught both devices. Key by device AND surface scope when tool sets differ per surface. Reuse for any future device family (touch, eraser end, jog wheel focus).',
      examples: ['editor_pen_device'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'replaying a toggle tool exits it',
      purpose: ['input'],
      severity: 'medium',
      description:
        'Several mesh tool commands are TOGGLES (mesh-paint etc.) — naively re-dispatching the remembered tool on every device flip exits the mode instead of confirming it. The lastToolByScopeRef dedupe in AppFrame is load-bearing: only dispatch when the remembered tool differs from the last tool dispatched for that scope. Keep this if the subscription is ever rewritten.',
      evidence: ['cart/editor/shell/AppFrame.tsx system:pointerDevice subscription'],
    },
  ],
};
