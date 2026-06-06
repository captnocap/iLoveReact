// hmsc-wire — quick-and-dirty wireframe layouts for the hmsc-int UI rework.
// Run with `tools/rjit dev hmsc-wire`, tinker until right, then graduate the
// settled classes into hmsc-int/studio.cls.ts.
//
// W1 — THE CHROME. hmsc-int's ProjectBar shape captured 1:1 plus the missing
// WINDOW CONTROLS flush right (borderless host: the strip IS the titlebar;
// the dead middle carries windowDrag, min/max/close call __window_*).
//
// W2 — THE UNIFIED ASSET EDITOR. character / item / vehicle / material folded
// into ONE interface:   |1|2 |3   |4         |
//   1 category gutter (1:1 icons) · 2 item gutter (icon + name) ·
//   3 expanded properties panel · 4 the big preview — 3D/2D default, the
//   cutout painter's canvas interface as the toggle state. W2b exploded it
//   with full rosters + ~50-field typed panels.
//
// W3 — SETTINGS + LOGS, SAME SHAPE. The reinterpretation that makes it hold:
// column 4 was never "3D preview" — it is THE DEMONSTRATION SURFACE for the
// selection. Assets demonstrate by rendering; settings demonstrate by ACTING
// (physics = a figure jumping on loop, world = day-cycle scrub); the logs
// domain's demonstration IS its stream. Gutter 1 = domains, 2 = subjects,
// 3 = the knobs (the P2 tunables registry shape), 4 = the rig.
//
// The chrome nav is wired: characters/items/vehicles/textures land in W2,
// settings/log land in W3, the rest greybox.

import { useEffect, useState } from 'react';
import { Box, ScrollView, Text } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { callHost } from '@reactjit/ffi';
import { C, CHROME_H, tone } from './wire.cls';

// ── W1 data: the captured nav set — the 12 routes the flat strip carries today.
const NAV: Array<{ icon: string; label: string }> = [
  { icon: 'LayoutGrid', label: 'editor' },
  { icon: 'Play', label: 'play' },
  { icon: 'FlaskConical', label: 'labs' },
  { icon: 'User', label: 'characters' },
  { icon: 'Gem', label: 'items' },
  { icon: 'Car', label: 'vehicles' },
  { icon: 'Boxes', label: 'voxels' },
  { icon: 'Sparkles', label: 'assist3d' },
  { icon: 'Scissors', label: 'cutout' },
  { icon: 'Palette', label: 'textures' },
  { icon: 'Activity', label: 'log' },
  { icon: 'Settings', label: 'settings' },
];

// ── typed wireframe fields (shared by W2 + W3) ───────────────────────────────

type Cat = 'character' | 'item' | 'vehicle' | 'material';

type WF =
  | { k: string; t: 'val' | 'num'; v: string }
  | { k: string; t: 'bool'; v: boolean }
  | { k: string; t: 'slider'; v: number; show: string }
  | { k: string; t: 'enum'; v: string; opts: string[] }
  | { k: string; t: 'color'; v: string };

// terse constructors so the fake data below reads like a spec sheet
const val = (k: string, v: string): WF => ({ k, t: 'val', v });
const num = (k: string, v: string): WF => ({ k, t: 'num', v });
const onoff = (k: string, v: boolean): WF => ({ k, t: 'bool', v });
const sl = (k: string, v: number, show: string): WF => ({ k, t: 'slider', v, show });
const en = (k: string, v: string, opts: string[]): WF => ({ k, t: 'enum', v, opts });
const col = (k: string, v: string): WF => ({ k, t: 'color', v });

interface WireGroup { title: string; fields: WF[] }
interface WireCat { icon: string; kicker: string; items: string[]; groups: WireGroup[] }

const CATS: Cat[] = ['character', 'item', 'vehicle', 'material'];

// group accents cycle through the studio status palette
const ACCENTS = ['primary', 'info', 'warning', 'success', 'error', 'accentTeal'];

const DB: Record<Cat, WireCat> = {
  character: {
    icon: 'User', kicker: 'CHARACTERS',
    items: [
      'dexter', 'officer briggs', 'paramedic vee', 'street vendor', 'shopkeep',
      'bouncer', 'taxi driver', 'jogger', 'old man pete', 'hotdog guy',
      'beat cop', 'detective marl', 'nurse', 'mechanic', 'barfly',
      'busker', 'delivery kid', 'gull lady', 'pawn clerk', 'night clerk',
      'tourist', 'lost tourist', 'pickpocket', 'priest',
    ],
    groups: [
      { title: 'IDENTITY', fields: [val('name', 'dexter'), en('kind', 'civilian', ['civilian', 'cop', 'medic']), val('tags', 'street, day'), num('id', '0x2f41')] },
      { title: 'BODY', fields: [en('shape', 'lean', ['lean', 'avg', 'heavy']), sl('height', 0.62, '1.84'), sl('bulk', 0.35, '0.35'), en('posture', 'upright', ['upright', 'slouch']), val('hands', 'globe')] },
      { title: 'FACE', fields: [val('face', 'decal #2'), col('skin', '#c98d6b'), col('eyes', '#5b4632'), en('expr', 'neutral', ['neutral', 'smile', 'scowl'])] },
      { title: 'CLOTHES', fields: [en('top', 'hoodie', ['tee', 'hoodie', 'jacket']), en('bottoms', 'jeans', ['jeans', 'shorts', 'slacks']), val('shoes', 'sneakers'), val('print', 'plain'), val('extras', 'cap'), col('palette', '#3b4a63')] },
      { title: 'PAINT', fields: [onoff('painted', true), val('skin doc', 'dexter_v3'), num('res', '256'), onoff('dirty', false)] },
      { title: 'ANIMATION', fields: [en('idle', 'sway', ['sway', 'still', 'fidget']), en('walk', 'default', ['default', 'strut']), en('run', 'jog', ['jog', 'sprint']), onoff('talk', true), sl('blink', 0.4, '0.4')] },
      { title: 'PERCEPTION', fields: [num('fov', '110°'), sl('cone', 0.55, '18m'), sl('hearing', 0.7, '0.7'), onoff('escalates', true), en('profile', 'civilian', ['civilian', 'guard', 'cop'])] },
      { title: 'COMBAT', fields: [num('health', '100'), onoff('melee', false), sl('accuracy', 0.25, '0.25'), onoff('flees', true)] },
      { title: 'BEHAVIOR', fields: [val('schedule', 'day shift'), val('home', 'docks 4'), num('wander', '12m'), sl('brave', 0.2, '0.2')] },
      { title: 'INVENTORY', fields: [num('slots', '4'), val('pockets', 'wallet, keys'), num('cash', '$23')] },
    ],
  },
  item: {
    icon: 'Gem', kicker: 'ITEMS',
    items: [
      'bat', 'pistol', 'soda can', 'key card', 'crowbar', 'wrench',
      'burner phone', 'duct tape', 'spray can', 'lockpick', 'wallet', 'badge',
      'medkit', 'energy bar', 'umbrella', 'boombox', 'skateboard', 'golf club',
      'traffic cone', 'donut',
    ],
    groups: [
      { title: 'IDENTITY', fields: [val('name', 'bat'), en('class', 'melee', ['melee', 'ranged', 'consumable', 'key']), val('tags', 'blunt, wood'), num('id', '0x0b17')] },
      { title: 'SCULPT', fields: [val('blockout', 'voxel 12³'), sl('inflate', 0.4, '0.4'), num('smooth', '2'), onoff('mirror', true), en('axis', 'y', ['x', 'y', 'z'])] },
      { title: 'GRIP', fields: [en('hand', 'right', ['right', 'left', 'both']), sl('scale', 0.5, '1.0'), val('offset', '0, 2, 0'), num('pitch', '12°')] },
      { title: 'WORLD DROP', fields: [onoff('droppable', true), sl('spin', 0.3, '0.3'), num('bob', '4cm'), col('glint', '#ffe9a8')] },
      { title: 'HUD', fields: [val('icon', 'sdf:bat'), en('slot', 'weapon', ['weapon', 'tool', 'misc']), onoff('stackable', false), num('max stack', '1')] },
      { title: 'ECONOMY', fields: [num('value', '$15'), onoff('fence only', false), sl('heat', 0.1, '0.1')] },
    ],
  },
  vehicle: {
    icon: 'Car', kicker: 'VEHICLES',
    items: [
      'sedan', 'taxi', 'box truck', 'cop car', 'ambulance', 'bus',
      'moped', 'sports coupe', 'pickup', 'van', 'garbage truck', 'limo',
      'delivery van', 'beater', 'tow truck', 'ice cream truck',
    ],
    groups: [
      { title: 'IDENTITY', fields: [val('name', 'sedan'), en('class', 'civilian', ['civilian', 'service', 'emergency']), val('tags', 'common, day'), num('id', '0x77a0')] },
      { title: 'BODY', fields: [num('wheelbase', '2.7m'), num('height', '1.4m'), num('wheels', '4'), sl('stance', 0.5, '0.5'), en('cab', 'closed', ['closed', 'open'])] },
      { title: 'PAINT', fields: [en('livery', 'plain', ['plain', 'taxi', 'fleet']), col('base', '#7a8aa0'), col('trim', '#22324a'), onoff('auto glass', true), val('decals', 'none')] },
      { title: 'DRIVE', fields: [num('top speed', '38'), sl('accel', 0.45, '0.45'), sl('grip', 0.8, '0.8'), sl('brake', 0.6, '0.6'), en('drive', 'rwd', ['fwd', 'rwd', 'awd'])] },
      { title: 'WHEELS', fields: [num('radius', '34cm'), sl('width', 0.4, '0.4'), col('rim', '#c9ced6')] },
      { title: 'LIGHTS', fields: [onoff('headlights', true), onoff('beacon', false), col('beacon col', '#3da9ff'), sl('glow', 0.5, '0.5')] },
      { title: 'DAMAGE', fields: [num('health', '400'), onoff('crumple', true), onoff('glass breaks', true), sl('burn', 0.3, '0.3')] },
      { title: 'SEATS', fields: [num('seats', '4'), en('entry', 'doors', ['doors', 'hop in']), onoff('passengers', true)] },
    ],
  },
  material: {
    icon: 'Palette', kicker: 'MATERIALS',
    items: [
      'brick', 'asphalt', 'auto glass', 'storefront', 'concrete', 'sidewalk',
      'mud', 'grass', 'sand', 'marble', 'rust metal', 'corrugated',
      'neon sign', 'awning stripe', 'roof tar', 'chain link', 'plywood',
      'graffiti wall', 'tile checker', 'stucco', 'hedge', 'water',
    ],
    groups: [
      { title: 'SOURCE', fields: [en('layer', 'shader', ['shader', 'decal', 'image']), val('recipe', 'brick.wgsl'), en('state', 'frozen', ['frozen', 'live']), num('params', '7')] },
      { title: 'BAKE', fields: [en('size', '256', ['128', '256', '512']), onoff('mips', true), num('last bake', '2m ago')] },
      { title: 'RENDER', fields: [num('tiling', '1×1'), sl('glossy', 0.2, '0.2'), sl('alpha', 1.0, '1.0'), col('emissive', '#000000'), onoff('two-sided', false)] },
      { title: 'SURFACE', fields: [en('physics', 'concrete', ['concrete', 'road', 'sand', 'mud']), onoff('breakable', false), num('health', '—'), sl('friction', 0.75, '0.75')] },
      { title: 'SLOTS', fields: [num('tiles', '14'), num('faces', '3'), num('pieces', '0'), val('last used', 'downtown')] },
      { title: 'HISTORY', fields: [val('created', 'may 28'), val('edited', 'jun 4'), num('versions', '6')] },
    ],
  },
};

const PAINT_TOOLS = ['Brush', 'Eraser', 'PaintBucket', 'Pipette', 'Grid3x3'];

// ── W3 data: settings domains (the P2 tunables shape) + the logs domain ──────

type Dom = 'physics' | 'camera' | 'world' | 'perception' | 'input' | 'editor' | 'logs';

interface WireSubject { name: string; groups: WireGroup[]; note: string }
interface WireDom { icon: string; kicker: string; rig: 'physics' | 'time' | 'logs' | 'note'; subjects: WireSubject[] }

const DOMS: Dom[] = ['physics', 'camera', 'world', 'perception', 'input', 'editor', 'logs'];

const SET_DB: Record<Dom, WireDom> = {
  physics: {
    icon: 'Zap', kicker: 'PHYSICS', rig: 'physics',
    subjects: [
      { name: 'movement', note: 'the figure walks/jumps with these numbers', groups: [
        { title: 'WALK', fields: [sl('speed', 0.55, '4.2'), sl('run ×', 0.6, '1.6'), sl('strafe', 0.45, '0.8'), onoff('sprint', true)] },
        { title: 'AIR', fields: [sl('control', 0.3, '0.3'), sl('friction', 0.55, '0.55')] },
      ] },
      { name: 'gravity & jump', note: 'step the gravity knob in the panel — the jump reacts', groups: [
        { title: 'GRAVITY', fields: [num('gravity', '9.8'), num('terminal', '38')] },
        { title: 'JUMP', fields: [sl('height', 0.5, '1.1m'), num('coyote', '80ms'), onoff('double', false)] },
      ] },
      { name: 'vehicle handling', note: 'a test sedan laps with these numbers', groups: [
        { title: 'ENGINE', fields: [sl('torque', 0.5, '0.5'), num('top speed', '38')] },
        { title: 'TIRES', fields: [sl('grip', 0.8, '0.8'), onoff('drift', false)] },
      ] },
      { name: 'collisions', note: 'the figure walks into a wall + up a step', groups: [
        { title: 'BODY', fields: [num('radius', '34cm'), num('step', '0.4m')] },
        { title: 'WORLD', fields: [onoff('heightfield', true), sl('push', 0.4, '0.4')] },
      ] },
      { name: 'ragdoll', note: 'the figure takes a hit and crumples', groups: [
        { title: 'TRIGGER', fields: [num('impulse', '120'), num('recover', '2.5s')] },
        { title: 'LIMBS', fields: [sl('stiffness', 0.35, '0.35'), sl('flop', 0.7, '0.7')] },
      ] },
    ],
  },
  camera: {
    icon: 'Video', kicker: 'CAMERA', rig: 'note',
    subjects: [
      { name: 'follow cam', note: 'the rig follows a pacing figure with these numbers', groups: [
        { title: 'FRAME', fields: [sl('distance', 0.5, '6.5'), sl('height', 0.4, '2.2'), num('fov', '65°')] },
        { title: 'LAG', fields: [sl('damping', 0.35, '0.35'), sl('look-ahead', 0.25, '0.25')] },
      ] },
      { name: 'orbit rig', note: 'the rig sweeps a demo block on loop', groups: [
        { title: 'ORBIT', fields: [sl('speed', 0.3, '0.3'), num('zoom min', '4'), num('zoom max', '14')] },
      ] },
      { name: 'play camera', note: 'the embodied camera mode the game boots with', groups: [
        { title: 'MODE', fields: [en('rig', 'follow', ['follow', 'iso', 'first']), en('shoulder', 'r', ['l', 'r'])] },
      ] },
      { name: 'screen shake', note: 'a test impact fires every 2s', groups: [
        { title: 'SHAKE', fields: [sl('intensity', 0.4, '0.4'), sl('decay', 0.6, '0.6'), onoff('on damage', true)] },
      ] },
    ],
  },
  world: {
    icon: 'Sun', kicker: 'WORLD', rig: 'time',
    subjects: [
      { name: 'sky & time', note: 'scrub the hour — the stage relights', groups: [
        { title: 'TIME', fields: [en('start', 'noon', ['midnight', 'dawn', 'noon', 'dusk']), sl('day length', 0.5, '24m')] },
        { title: 'SUN', fields: [sl('size', 0.3, '0.018'), sl('glow', 0.42, '0.42')] },
      ] },
      { name: 'weather', note: 'the stage weathers over', groups: [
        { title: 'WEATHER', fields: [en('preset', 'clear', ['clear', 'hazy', 'cloudy', 'storm']), sl('gloom', 0.1, '0.1')] },
      ] },
      { name: 'fog & draw', note: 'the stage fogs out at this distance', groups: [
        { title: 'FOG', fields: [onoff('enabled', true), sl('density', 0.4, '0.4')] },
        { title: 'DRAW', fields: [num('distance', '220m')] },
      ] },
      { name: 'ambience', note: 'ambient light wash on the stage', groups: [
        { title: 'LIGHT', fields: [sl('ambient', 0.48, '0.48'), col('color', '#bcd6f0')] },
      ] },
    ],
  },
  perception: {
    icon: 'Eye', kicker: 'PERCEPTION', rig: 'note',
    subjects: [
      { name: 'vision', note: 'a FoV cone sweeps a test ped — step inside it', groups: [
        { title: 'CONE', fields: [num('fov', '110°'), sl('range', 0.55, '18m')] },
        { title: 'CHECKS', fields: [onoff('line of sight', true), sl('cover', 0.5, '0.5')] },
      ] },
      { name: 'hearing', note: 'a noise ring expands per footstep on the stage', groups: [
        { title: 'NOISE', fields: [sl('radius', 0.5, '8m'), sl('tile noise', 0.4, '0.4')] },
      ] },
      { name: 'escalation', note: 'the test ped escalates upward through kinds', groups: [
        { title: 'LADDER', fields: [onoff('upward', true), num('cooldown', '20s')] },
      ] },
    ],
  },
  input: {
    icon: 'Keyboard', kicker: 'INPUT', rig: 'note',
    subjects: [
      { name: 'keyboard', note: 'key tester — pressed keys light up here', groups: [
        { title: 'BINDS', fields: [val('jump', 'SPACE'), val('sprint', 'SHIFT'), val('interact', 'E'), val('test/build', 'F1/F2')] },
        { title: 'REPEAT', fields: [num('delay', '280ms')] },
      ] },
      { name: 'mouse', note: 'move the mouse — the stage crosshair follows with this curve', groups: [
        { title: 'LOOK', fields: [sl('sensitivity', 0.5, '0.5'), onoff('invert', false)] },
        { title: 'WHEEL', fields: [sl('zoom step', 0.4, '0.4')] },
      ] },
      { name: 'gamepad', note: 'stick tester — deadzone ring visualized', groups: [
        { title: 'STICKS', fields: [sl('deadzone', 0.15, '0.15'), en('curve', 'expo', ['linear', 'expo'])] },
      ] },
    ],
  },
  editor: {
    icon: 'Settings', kicker: 'EDITOR', rig: 'note',
    subjects: [
      { name: 'autosave', note: 'editor behavior — the knobs act on the editor itself', groups: [
        { title: 'DEBOUNCE', fields: [num('delay', '800ms'), onoff('flush on switch', true)] },
      ] },
      { name: 'canvas', note: 'editor behavior — the knobs act on the editor itself', groups: [
        { title: 'GRID', fields: [onoff('show', true), onoff('snap', true)] },
        { title: 'BRUSH', fields: [num('max size', '40')] },
      ] },
      { name: 'preview', note: 'editor behavior — the knobs act on the editor itself', groups: [
        { title: 'REBAKE', fields: [num('budget', '8ms')] },
        { title: 'CAMERA', fields: [onoff('persist pose', true)] },
      ] },
      { name: 'perf', note: 'editor behavior — the knobs act on the editor itself', groups: [
        { title: 'CHURN', fields: [onoff('probe', false), num('log cap', '100')] },
      ] },
    ],
  },
  logs: {
    icon: 'Activity', kicker: 'LOGS', rig: 'logs',
    subjects: [
      { name: 'world', note: '', groups: [
        { title: 'CHANNEL', fields: [onoff('persisted', true), num('cap', '100'), val('path', 'sessions/world')] },
        { title: 'ACTIVITY', fields: [num('events', '341'), val('last', '12s ago')] },
      ] },
      { name: 'tuning', note: '', groups: [
        { title: 'CHANNEL', fields: [onoff('persisted', true), num('cap', '200'), val('path', 'sessions/tuning')] },
        { title: 'ACTIVITY', fields: [num('events', '57'), val('last', '4m ago')] },
      ] },
      { name: 'sessions', note: '', groups: [
        { title: 'CHANNEL', fields: [onoff('persisted', true), num('cap', '200'), val('path', 'sessions/bus')] },
        { title: 'ACTIVITY', fields: [num('events', '129'), val('last', '40s ago')] },
      ] },
      { name: 'churn', note: '', groups: [
        { title: 'CHANNEL', fields: [onoff('persisted', false), num('cap', '500'), val('path', '(memory ring)')] },
        { title: 'ACTIVITY', fields: [num('events', '2.1k'), val('last', 'now')] },
      ] },
      { name: 'frame', note: '', groups: [
        { title: 'CHANNEL', fields: [onoff('persisted', false), num('cap', '500'), val('path', '(memory ring)')] },
        { title: 'ACTIVITY', fields: [num('events', '9.4k'), val('last', 'now')] },
      ] },
    ],
  },
};

// channel → studio tone (display only — mirrors the bus's toneFor idea)
const LOG_TONE: Record<string, string> = { world: 'primary', tuning: 'warning', sessions: 'success', churn: 'info', frame: 'error' };

const LOG_LINES: Array<{ t: string; ch: string; text: string }> = [
  { t: '14:02:41', ch: 'frame', text: 'fps 238 → 241' },
  { t: '14:02:39', ch: 'world', text: 'tile: painted 14 cells (road)' },
  { t: '14:02:38', ch: 'churn', text: 'setFloors n=4 → previewWorld rebuild 12ms' },
  { t: '14:02:31', ch: 'world', text: 'object: placed palm_tree at 12,-4' },
  { t: '14:02:28', ch: 'sessions', text: '/vehicles opened' },
  { t: '14:02:21', ch: 'tuning', text: 'physics.gravity ← 12.0' },
  { t: '14:02:19', ch: 'world', text: 'camera: settled' },
  { t: '14:02:12', ch: 'frame', text: 'paint spike 38ms (static surface re-bake)' },
  { t: '14:01:58', ch: 'world', text: 'object: moved bench' },
  { t: '14:01:55', ch: 'churn', text: 'cart re-render (floors)' },
  { t: '14:01:49', ch: 'sessions', text: 'commit: paint stroke ×34' },
  { t: '14:01:42', ch: 'tuning', text: 'camera.follow.damping ← 0.35' },
  { t: '14:01:38', ch: 'world', text: 'map: compiled downtown → game' },
  { t: '14:01:30', ch: 'frame', text: 'gpu upload 1.2mb' },
  { t: '14:01:24', ch: 'world', text: 'tile: height brush +3 (9 cells)' },
  { t: '14:01:19', ch: 'sessions', text: '/cutout closed' },
  { t: '14:01:11', ch: 'churn', text: 'previewWorld rebuild 9ms' },
  { t: '14:00:58', ch: 'tuning', text: 'reset walk.speed → default' },
  { t: '14:00:52', ch: 'world', text: 'object: rotated cop car 90°' },
  { t: '14:00:47', ch: 'frame', text: 'fps 240 steady' },
  { t: '14:00:41', ch: 'sessions', text: '/items opened' },
  { t: '14:00:33', ch: 'world', text: 'map: opened marina' },
  { t: '14:00:21', ch: 'churn', text: 'kind textures re-skinned (brick)' },
  { t: '14:00:09', ch: 'world', text: 'tile: painted 41 cells (sidewalk)' },
];

// ── shared little pieces ──────────────────────────────────────────────────────

function NavBtn(props: { icon: string; on: boolean; onPress: () => void }) {
  const B = props.on ? C.ChromeBtnOn : C.ChromeBtn;
  return (
    <B onPress={props.onPress}>
      <Icon name={props.icon} size={14} color={props.on ? tone('text') : tone('textSecondary')} />
    </B>
  );
}

function WindowControls() {
  return (
    <C.WinGroup>
      <C.WinBtn onPress={() => callHost<void>('__window_minimize', undefined as any)}>
        <Icon name="Minus" size={13} color={tone('textSecondary')} />
      </C.WinBtn>
      <C.WinBtn onPress={() => callHost<void>('__window_maximize', undefined as any)}>
        <Icon name="Square" size={11} color={tone('textSecondary')} />
      </C.WinBtn>
      <C.WinBtnClose onPress={() => callHost<void>('__window_close', undefined as any)}>
        <Icon name="X" size={13} color={tone('textSecondary')} />
      </C.WinBtnClose>
    </C.WinGroup>
  );
}

// ── W1: the chrome strip ──────────────────────────────────────────────────────

function ChromeStrip(props: { active: string; onNav: (label: string) => void }) {
  const [menuOn, setMenuOn] = useState(false);
  const [logOn, setLogOn] = useState(false);
  const MapPill = menuOn ? C.ChromePillOn : C.ChromePill;
  const SavePill = logOn ? C.ChromePillOn : C.ChromePill;
  return (
    <C.ChromeBar>
      <C.ChromeBrand>
        <Icon name="Map" size={14} color={tone('textDim')} />
        <C.ChromeKicker>WORLD EDITOR</C.ChromeKicker>
      </C.ChromeBrand>

      <C.ChromeRule />

      <MapPill onPress={() => setMenuOn((o) => !o)}>
        <Box style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone('success') }} />
        <C.ChromePillStrong>downtown</C.ChromePillStrong>
        <Icon name="ChevronDown" size={13} color={tone('textDim')} />
      </MapPill>

      <C.ChromePill onPress={() => {}}>
        <Icon name="Plus" size={13} color={tone('success')} />
        <C.ChromePillText>New map</C.ChromePillText>
      </C.ChromePill>

      {/* the dead middle — this IS the titlebar grab area */}
      <C.ChromeDragSpace windowDrag={true} />

      <C.ChromeGroup>
        {NAV.map((n) => (
          <NavBtn key={n.label} icon={n.icon} on={props.active === n.label} onPress={() => props.onNav(n.label)} />
        ))}
      </C.ChromeGroup>

      <C.ChromeRule />

      <C.ChromeGroup>
        <C.ChromeBtn onPress={() => {}}>
          <Icon name="Undo2" size={14} color={tone('textFaint')} />
        </C.ChromeBtn>
        <C.ChromeBtn onPress={() => {}}>
          <Icon name="Redo2" size={14} color={tone('textFaint')} />
        </C.ChromeBtn>
      </C.ChromeGroup>

      <C.ChromeRule />

      <C.ChromePill onPress={() => {}}>
        <Icon name="Hammer" size={13} color={tone('success')} />
        <C.ChromePillText>Compile</C.ChromePillText>
      </C.ChromePill>

      <SavePill onPress={() => setLogOn((o) => !o)}>
        <Icon name="Check" size={12} color={tone('success')} />
        <C.ChromePillFaint>saved</C.ChromePillFaint>
        <Icon name="ChevronDown" size={12} color={tone('textDim')} />
      </SavePill>

      <C.ChromeRule />

      {/* NEW: window controls — flat, flush right, full strip height */}
      <WindowControls />
    </C.ChromeBar>
  );
}

// ── typed control cells (shared by W2 + W3 panels) ────────────────────────────

// A bind makes a panel field LIVE: gutter 3 edits, column 4 reacts. This is
// the only edit path — the stage never grows its own controls.
interface FieldBind {
  num?: Record<string, { v: string; onStep: (dir: -1 | 1) => void }>;
  pick?: Record<string, { v: string; onPick: (o: string) => void }>;
}

function FieldCell({ f, bind }: { f: WF; bind?: FieldBind }) {
  const numBind = f.t === 'num' ? bind?.num?.[f.k] : undefined;
  const pickBind = f.t === 'enum' ? bind?.pick?.[f.k] : undefined;
  return (
    <C.Field>
      <C.FieldLabel>{f.k}</C.FieldLabel>
      {f.t === 'val' ? <C.FieldValue>{f.v}</C.FieldValue> : null}
      {f.t === 'num' ? (
        numBind ? (
          <>
            <C.StepBtn onPress={() => numBind.onStep(-1)}>
              <Icon name="Minus" size={10} color={tone('textSecondary')} />
            </C.StepBtn>
            <C.FieldValueNum>{numBind.v}</C.FieldValueNum>
            <C.StepBtn onPress={() => numBind.onStep(1)}>
              <Icon name="Plus" size={10} color={tone('textSecondary')} />
            </C.StepBtn>
          </>
        ) : (
          <C.FieldValueNum>{f.v}</C.FieldValueNum>
        )
      ) : null}
      {f.t === 'bool' ? (
        f.v ? (
          <C.ToggleTrackOn><C.ToggleKnob /></C.ToggleTrackOn>
        ) : (
          <C.ToggleTrack><C.ToggleKnobOff /></C.ToggleTrack>
        )
      ) : null}
      {f.t === 'slider' ? (
        <>
          <C.SliderTrack>
            <C.SliderFill style={{ width: `${Math.round(f.v * 100)}%` }} />
          </C.SliderTrack>
          <C.FieldValueNum>{f.show}</C.FieldValueNum>
        </>
      ) : null}
      {f.t === 'enum' ? (
        <C.SegMiniWrap>
          {f.opts.map((o) => {
            const cur = pickBind ? pickBind.v : f.v;
            const T = o === cur ? C.SegMiniTextOn : C.SegMiniText;
            if (pickBind) {
              const Cell = o === cur ? C.SegMiniPressOn : C.SegMiniPress;
              return <Cell key={o} onPress={() => pickBind.onPick(o)}><T>{o}</T></Cell>;
            }
            const Cell = o === cur ? C.SegMiniCellOn : C.SegMiniCell;
            return <Cell key={o}><T>{o}</T></Cell>;
          })}
        </C.SegMiniWrap>
      ) : null}
      {f.t === 'color' ? (
        <>
          <C.Swatch style={{ backgroundColor: f.v }} />
          <C.FieldValue>{f.v}</C.FieldValue>
        </>
      ) : null}
    </C.Field>
  );
}

function PropsGroups(props: { groups: WireGroup[]; bind?: FieldBind }) {
  return (
    <>
      {props.groups.map((g, gi) => {
        const accent = tone(ACCENTS[gi % ACCENTS.length]);
        return (
          <C.Group key={g.title}>
            <C.GroupHead>
              <C.GroupAccentBar style={{ backgroundColor: accent }} />
              <C.GroupTitle color={accent}>{g.title}</C.GroupTitle>
              <C.GroupRule />
              <C.GroupCount>{`${g.fields.length}`}</C.GroupCount>
            </C.GroupHead>
            <C.FieldStrip>
              {g.fields.map((f) => <FieldCell key={f.k} f={f} bind={props.bind} />)}
            </C.FieldStrip>
          </C.Group>
        );
      })}
    </>
  );
}

// ── W2: the unified asset editor ─────────────────────────────────────────────

function AssetEditor(props: { cat: Cat; onCat: (c: Cat) => void }) {
  const cat = props.cat;
  const [selByCat, setSelByCat] = useState<Record<Cat, number>>({ character: 0, item: 0, vehicle: 0, material: 0 });
  // 4's two states: the 3D/2D preview (default) ⇄ the cutout painter interface.
  const [mode, setMode] = useState<'preview' | 'paint'>('preview');
  const [paintTool, setPaintTool] = useState('Brush');

  const db = DB[cat];
  const sel = selByCat[cat];
  const selName = db.items[sel] ?? db.items[0];
  const fieldCount = db.groups.reduce((n, g) => n + g.fields.length, 0);

  const pickCat = (c: Cat) => { props.onCat(c); setMode('preview'); };
  const pickItem = (i: number) => { setSelByCat((s) => ({ ...s, [cat]: i })); setMode('preview'); };

  const PreviewSeg = mode === 'preview' ? C.SegCellOn : C.SegCell;
  const PreviewSegText = mode === 'preview' ? C.SegTextOn : C.SegText;
  const PaintSeg = mode === 'paint' ? C.SegCellOn : C.SegCell;
  const PaintSegText = mode === 'paint' ? C.SegTextOn : C.SegText;

  return (
    <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'row' }}>
      {/* 1 — category gutter */}
      <C.CatRail>
        {CATS.map((c) => {
          const B = c === cat ? C.CatBtnOn : C.CatBtn;
          return (
            <B key={c} onPress={() => pickCat(c)}>
              <Icon name={DB[c].icon} size={15} color={c === cat ? tone('primary') : tone('textSecondary')} />
            </B>
          );
        })}
      </C.CatRail>

      {/* 2 — item gutter: filter stub + the long scrolling roster */}
      <C.ItemRail>
        <C.RailKicker>{`${db.kicker} · ${db.items.length}`}</C.RailKicker>
        <C.RailSearch>
          <C.RailSearchHint>filter…</C.RailSearchHint>
        </C.RailSearch>
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
          <Box style={{ flexDirection: 'column', gap: 2, paddingBottom: 8 }}>
            {db.items.map((name, i) => {
              const R = i === sel ? C.ItemRowOn : C.ItemRow;
              const T = i === sel ? C.ItemRowTextOn : C.ItemRowText;
              return (
                <R key={name} onPress={() => pickItem(i)}>
                  <Icon name={db.icon} size={13} color={i === sel ? tone('primary') : tone('textFaint')} />
                  <T>{name}</T>
                </R>
              );
            })}
            {/* the add row rides the end of the list */}
            <C.ItemRow onPress={() => {}}>
              <Icon name="Plus" size={13} color={tone('success')} />
              <C.ItemRowText>{`new ${cat}`}</C.ItemRowText>
            </C.ItemRow>
          </Box>
        </ScrollView>
      </C.ItemRail>

      {/* 3 — the full expanded properties panel (scrolls; the density test) */}
      <C.PropsCol>
        <C.HeroBar>
          <Icon name={db.icon} size={16} color={tone('primary')} />
          <Box style={{ flexDirection: 'column', gap: 1 }}>
            <C.HeroName>{selName}</C.HeroName>
            <C.HeroSub>{`${cat} · ${db.groups.length} groups · ${fieldCount} fields`}</C.HeroSub>
          </Box>
        </C.HeroBar>
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
          <PropsGroups groups={db.groups} />
        </ScrollView>
      </C.PropsCol>

      {/* 4 — the big preview: 3D/2D default ⇄ the cutout painter toggle */}
      <C.PreviewCol>
        <C.PreviewBar>
          <C.WireTag>{`${selName.toUpperCase()} · ${cat}`}</C.WireTag>
          <Box style={{ flexGrow: 1 }} />
          <C.ModeSeg>
            <PreviewSeg onPress={() => setMode('preview')}>
              <PreviewSegText>3D / 2D</PreviewSegText>
            </PreviewSeg>
            <PaintSeg onPress={() => setMode('paint')}>
              <PaintSegText>PAINT</PaintSegText>
            </PaintSeg>
          </C.ModeSeg>
        </C.PreviewBar>

        {mode === 'preview' ? (
          <C.PreviewSurface>
            <C.WireTag>3D / 2D PREVIEW</C.WireTag>
            <C.WireNote>{`live ${cat} preview of "${selName}" fills this whole surface`}</C.WireNote>
          </C.PreviewSurface>
        ) : (
          <>
            <C.PaintWrap>
              <C.ToolRail>
                {PAINT_TOOLS.map((t) => {
                  const B = t === paintTool ? C.ToolBtnOn : C.ToolBtn;
                  return (
                    <B key={t} onPress={() => setPaintTool(t)}>
                      <Icon name={t} size={14} color={t === paintTool ? tone('primary') : tone('textSecondary')} />
                    </B>
                  );
                })}
              </C.ToolRail>
              <C.PreviewSurface>
                <C.WireTag>CUTOUT PAINTER</C.WireTag>
                <C.WireNote>{`painting "${selName}" — the cutout canvas interface mounts here`}</C.WireNote>
              </C.PreviewSurface>
            </C.PaintWrap>
            <C.PaintStatus>
              <C.WireTag>{`tool: ${paintTool.toLowerCase()}`}</C.WireTag>
              <Box style={{ flexGrow: 1 }} />
              <C.WireTag>brush 8px · layer skin</C.WireTag>
            </C.PaintStatus>
          </>
        )}
      </C.PreviewCol>
    </Box>
  );
}

// ── W3: the demo rigs ─────────────────────────────────────────────────────────
// Rigs DEMONSTRATE only — no controls in here. The knobs live in gutter 3 (the
// one edit surface, bound via FieldBind); the rig just receives the values.

// PHYSICS — a real animated jump rig. Step the panel's gravity knob and the
// arc changes instantly. This is the col-3-edits → col-4-reacts loop, alive.
function PhysicsRig(props: { gravity: number }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 0.033), 33);
    return () => clearInterval(id);
  }, []);
  const apex = Math.max(20, Math.min(200, 1100 / props.gravity)); // px — lighter gravity, higher arc
  const y = Math.round(apex * Math.abs(Math.sin(t * Math.sqrt(props.gravity) * 0.55)));
  return (
    <C.Stage>
      <C.StageFigure style={{ marginBottom: y }} />
      <C.StageFloor />
    </C.Stage>
  );
}

// WORLD — day-cycle stage: the panel's `start` hour enum relights it.
// Sky values lifted from the lab sky tables (demo data, not UI chrome).
const HOURS = [
  { name: 'midnight', bg: '#05060f', sun: '#20304f' },
  { name: 'dawn', bg: '#172a55', sun: '#ff9a5a' },
  { name: 'noon', bg: '#1f6fd6', sun: '#fff4d6' },
  { name: 'dusk', bg: '#1d2f63', sun: '#ff7a44' },
];

function TimeRig(props: { hour: string }) {
  const h = HOURS.find((x) => x.name === props.hour) ?? HOURS[2];
  return (
    <C.Stage style={{ backgroundColor: h.bg }}>
      <Box style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: h.sun, marginBottom: 90 }} />
      <C.StageFloor />
    </C.Stage>
  );
}

// LOGS — the channel's demonstration IS its stream.
function LogStream(props: { channel: string; all: boolean }) {
  const rows = props.all ? LOG_LINES : LOG_LINES.filter((l) => l.ch === props.channel);
  return (
    <C.LogPane>
      <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
        <Box style={{ flexDirection: 'column' }}>
          {rows.map((l, i) => (
            <C.LogRow key={`${l.t}-${i}`}>
              <C.LogTime>{l.t}</C.LogTime>
              <C.LogChip style={{ backgroundColor: tone(LOG_TONE[l.ch] ?? 'primary') }}>
                <C.LogChipText>{l.ch}</C.LogChipText>
              </C.LogChip>
              <C.LogText>{l.text}</C.LogText>
            </C.LogRow>
          ))}
        </Box>
      </ScrollView>
    </C.LogPane>
  );
}

// ── W3: settings + logs in the same four gutters ─────────────────────────────

function SettingsEditor(props: { dom: Dom; onDom: (d: Dom) => void }) {
  const dom = props.dom;
  const [selByDom, setSelByDom] = useState<Record<Dom, number>>({ physics: 0, camera: 0, world: 0, perception: 0, input: 0, editor: 0, logs: 0 });
  const [logAll, setLogAll] = useState(true);

  // The live demo values. Edited ONLY through gutter 3's bound fields — the
  // rigs receive them and demonstrate. (The real page binds tunables here.)
  const [gravity, setGravity] = useState(9.8);
  const [hour, setHour] = useState('noon');
  const bind: FieldBind | undefined =
    dom === 'physics'
      ? { num: { gravity: { v: gravity.toFixed(1), onStep: (d) => setGravity((g) => Math.max(3, Math.min(25, Math.round(g + d)))) } } }
      : dom === 'world'
        ? { pick: { start: { v: hour, onPick: setHour } } }
        : undefined;

  const db = SET_DB[dom];
  const sel = selByDom[dom];
  const subject = db.subjects[sel] ?? db.subjects[0];
  const fieldCount = subject.groups.reduce((n, g) => n + g.fields.length, 0);

  const pickDom = (d: Dom) => { props.onDom(d); setLogAll(true); };
  const pickSubject = (i: number) => { setSelByDom((s) => ({ ...s, [dom]: i })); setLogAll(false); };

  const AllSeg = logAll ? C.SegCellOn : C.SegCell;
  const AllSegText = logAll ? C.SegTextOn : C.SegText;
  const ChSeg = !logAll ? C.SegCellOn : C.SegCell;
  const ChSegText = !logAll ? C.SegTextOn : C.SegText;

  return (
    <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'row' }}>
      {/* 1 — domain gutter */}
      <C.CatRail>
        {DOMS.map((d) => {
          const B = d === dom ? C.CatBtnOn : C.CatBtn;
          return (
            <B key={d} onPress={() => pickDom(d)}>
              <Icon name={SET_DB[d].icon} size={15} color={d === dom ? tone('primary') : tone('textSecondary')} />
            </B>
          );
        })}
      </C.CatRail>

      {/* 2 — subject gutter (channels, for the logs domain) */}
      <C.ItemRail>
        <C.RailKicker>{`${db.kicker} · ${db.subjects.length}`}</C.RailKicker>
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
          <Box style={{ flexDirection: 'column', gap: 2, paddingBottom: 8 }}>
            {db.subjects.map((s, i) => {
              const R = i === sel ? C.ItemRowOn : C.ItemRow;
              const T = i === sel ? C.ItemRowTextOn : C.ItemRowText;
              return (
                <R key={s.name} onPress={() => pickSubject(i)}>
                  <Icon name={db.icon} size={13} color={i === sel ? tone('primary') : tone('textFaint')} />
                  <T>{s.name}</T>
                </R>
              );
            })}
          </Box>
        </ScrollView>
      </C.ItemRail>

      {/* 3 — the knobs (the P2 tunables registry shape) */}
      <C.PropsCol>
        <C.HeroBar>
          <Icon name={db.icon} size={16} color={tone('primary')} />
          <Box style={{ flexDirection: 'column', gap: 1 }}>
            <C.HeroName>{subject.name}</C.HeroName>
            <C.HeroSub>{`${dom} · ${subject.groups.length} groups · ${fieldCount} knobs`}</C.HeroSub>
          </Box>
        </C.HeroBar>
        <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0 }}>
          <PropsGroups groups={subject.groups} bind={bind} />
        </ScrollView>
      </C.PropsCol>

      {/* 4 — THE RIG: the selection demonstrates itself (receives, never edits) */}
      <C.PreviewCol>
        <C.PreviewBar>
          <C.WireTag>{`${subject.name.toUpperCase()} · ${dom}`}</C.WireTag>
          <Box style={{ flexGrow: 1 }} />
          {db.rig === 'logs' ? (
            <C.ModeSeg>
              <AllSeg onPress={() => setLogAll(true)}>
                <AllSegText>ALL</AllSegText>
              </AllSeg>
              <ChSeg onPress={() => setLogAll(false)}>
                <ChSegText>{subject.name.toUpperCase()}</ChSegText>
              </ChSeg>
            </C.ModeSeg>
          ) : (
            <C.WireTag>DEMO RIG</C.WireTag>
          )}
        </C.PreviewBar>

        {db.rig === 'physics' ? <PhysicsRig gravity={gravity} /> : null}
        {db.rig === 'time' ? <TimeRig hour={hour} /> : null}
        {db.rig === 'logs' ? <LogStream channel={subject.name} all={logAll} /> : null}
        {db.rig === 'note' ? (
          <C.PreviewSurface>
            <C.WireTag>DEMO RIG</C.WireTag>
            <C.WireNote>{subject.note}</C.WireNote>
          </C.PreviewSurface>
        ) : null}
      </C.PreviewCol>
    </Box>
  );
}

// ── the cart: nav-wired bodies ────────────────────────────────────────────────

const NAV_TO_CAT: Record<string, Cat> = { characters: 'character', items: 'item', vehicles: 'vehicle', textures: 'material' };
const CAT_TO_NAV: Record<Cat, string> = { character: 'characters', item: 'items', vehicle: 'vehicles', material: 'textures' };

export default function WireframeCart() {
  const [active, setActive] = useState('characters');
  const [cat, setCat] = useState<Cat>('character');
  const [dom, setDom] = useState<Dom>('physics');

  const onNav = (label: string) => {
    setActive(label);
    const c = NAV_TO_CAT[label];
    if (c) setCat(c);
    if (label === 'settings') setDom('physics');
    if (label === 'log') setDom('logs');
  };

  const inAssets = !!NAV_TO_CAT[active];
  const inSettings = active === 'settings' || active === 'log';

  return (
    <C.WireRoot>
      <ChromeStrip active={active} onNav={onNav} />
      {inAssets ? (
        <AssetEditor cat={cat} onCat={(c) => { setCat(c); setActive(CAT_TO_NAV[c]); }} />
      ) : inSettings ? (
        <SettingsEditor dom={dom} onDom={(d) => { setDom(d); setActive(d === 'logs' ? 'log' : 'settings'); }} />
      ) : (
        <C.WireBody>
          <C.WireSlot style={{ flexGrow: 1 }}>
            <C.WireTag>{`ROUTE SURFACE · /${active}`}</C.WireTag>
            <C.WireNote>
              {active === 'cutout'
                ? "cutout folds into the asset editor's PAINT toggle (W2) — this icon retires"
                : 'not wireframed yet'}
            </C.WireNote>
          </C.WireSlot>
        </C.WireBody>
      )}
    </C.WireRoot>
  );
}
