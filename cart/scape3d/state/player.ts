import type { Cam } from '../world/projection';
import type { EvidenceAxis, HighPhase, HighState, LifeState, Player, Suspicion, Tile, VisualSignature } from '../design';

export type PathStep = { x: number; y: number };

export type ScapePlayerState = Cam & {
  body: Player;
  path: PathStep[];
};

export const PLAYER_SPEED = 4.2;

const SUSPICION_AXES: EvidenceAxis[] = ['visual', 'fund', 'pattern', 'digital', 'location'];

// Per-axis weights for notoriety. Strategic by design: visual heat hurts most
// (you were SEEN), funny-money is slow to trace so it's discounted. See the
// contract comment on Player.notoriety in design.ts.
const SUSPICION_WEIGHTS: Record<EvidenceAxis, number> = {
  visual: 1.5,
  fund: 0.8,
  pattern: 1.0,
  digital: 1.0,
  location: 1.0,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function zeroSuspicion(): Suspicion {
  return { visual: 0, fund: 0, pattern: 0, digital: 0, location: 0 };
}

function zeroHigh(): HighState {
  return { intensity: 0, phase: 'sober', sinceMs: 0, rising: false, phonePressure: 0, marketReadNoise: 0, agentAgitation: 0 };
}

// Peak ≠ crash: the phase is derived from magnitude + whether we just dosed.
function derivePhase(intensity: number, rising: boolean): HighPhase {
  if (intensity < 0.05) return 'sober';
  if (intensity >= 0.85) return 'overamped';
  if (rising) return intensity < 0.5 ? 'comeup' : 'peak';
  return intensity > 0.45 ? 'peak' : 'crashing';
}

// Recompute the pressures the high pushes onto other systems. Rising/peak = the
// world screams at you; crashing = it goes flat and bored.
function recomputeHigh(h: HighState): void {
  h.phase = derivePhase(h.intensity, h.rising);
  const i = h.intensity;
  h.phonePressure = i;
  h.marketReadNoise = clamp((i - 0.3) / 0.7, 0, 1);
  const up = h.rising || h.phase === 'peak' || h.phase === 'overamped';
  h.agentAgitation = up ? i : i * 0.4;
}

function defaultCostume(): VisualSignature {
  return { silhouette: 'avg', color: '#2e6da4', accessory: 'none' };
}

function tileFromPosition(px: number, py: number): Tile {
  return { x: Math.floor(px), y: Math.floor(py) };
}

// notoriety = weighted blend of the five axes, normalised to 0..100. A blend (not
// the max) means heat spread thin is cheaper than one spiked axis — players hedge.
export function computeNotoriety(suspicion: Suspicion): number {
  let weighted = 0;
  let total = 0;
  for (const axis of SUSPICION_AXES) {
    const w = SUSPICION_WEIGHTS[axis];
    weighted += suspicion[axis] * w;
    total += w;
  }
  return clamp(weighted / total, 0, 100);
}

export function syncPlayerBody(state: ScapePlayerState): void {
  state.body.tile = tileFromPosition(state.px, state.py);
  state.body.notoriety = computeNotoriety(state.body.suspicion);
}

export function createInitialPlayerBody(tile: Tile, facing: number): Player {
  return {
    tile,
    facing,
    health: 100,
    maxHealth: 100,
    armor: 0,
    maxArmor: 100,
    money: 320,
    simWalletId: 0,
    suspicion: zeroSuspicion(),
    notoriety: 0,
    costume: defaultCostume(),
    pockets: [],
    assets: [],
    skills: { combat: 0.15, stealth: 0.2, hacking: 0.05, trading: 0.1, social: 0.25 },
    lifeState: 'free',
    rapSheet: { busts: 0, burnedSignatures: [], heatRamp: 1 },
    career: { kills: 0, style: 0, earned: 0 },
    high: zeroHigh(),
  };
}

export function createInitialPlayerState(): ScapePlayerState {
  const px = 22.5;
  const py = 24.5;
  const facing = -Math.PI / 2;
  const state: ScapePlayerState = {
    px: 22.5,
    py: 24.5,
    yaw: Math.PI * 0.25,
    pitch: 0.62,
    zoom: 1.1,
    mode: 'tp',
    lookPitch: 0,
    body: createInitialPlayerBody(tileFromPosition(px, py), facing),
    path: [],
  };
  syncPlayerBody(state);
  return state;
}

export function advancePlayer(state: ScapePlayerState, dt: number): void {
  state.body.high.sinceMs += dt * 1000;
  setHigh(state, state.body.high.intensity - 0.12 * dt); // decay → rising=false → crashing
  if (!state.path.length) {
    syncPlayerBody(state);
    return;
  }
  const next = state.path[0];
  const dx = next.x - state.px;
  const dy = next.y - state.py;
  const d = Math.hypot(dx, dy);
  state.body.facing = Math.atan2(dy, dx);
  if (d <= PLAYER_SPEED * dt) {
    state.px = next.x;
    state.py = next.y;
    state.path.shift();
  } else {
    const tt = (PLAYER_SPEED * dt) / d;
    state.px += dx * tt;
    state.py += dy * tt;
  }
  syncPlayerBody(state);
}

export function setHealth(state: ScapePlayerState, health: number): void {
  state.body.health = clamp(Math.round(health), 0, state.body.maxHealth);
}

export function adjustHealth(state: ScapePlayerState, delta: number): void {
  setHealth(state, state.body.health + delta);
}

export function setArmor(state: ScapePlayerState, armor: number): void {
  state.body.armor = clamp(Math.round(armor), 0, state.body.maxArmor);
}

export function adjustArmor(state: ScapePlayerState, delta: number): void {
  setArmor(state, state.body.armor + delta);
}

export function adjustMoney(state: ScapePlayerState, delta: number): void {
  state.body.money = Math.max(0, Math.round(state.body.money + delta));
}

export function setSuspicionAxis(state: ScapePlayerState, axis: EvidenceAxis, value: number): void {
  state.body.suspicion[axis] = clamp(Math.round(value), 0, 100);
  state.body.notoriety = computeNotoriety(state.body.suspicion);
}

export function adjustSuspicionAxis(state: ScapePlayerState, axis: EvidenceAxis, delta: number): void {
  setSuspicionAxis(state, axis, state.body.suspicion[axis] + delta);
}

export function setLifeState(state: ScapePlayerState, lifeState: LifeState): void {
  state.body.lifeState = lifeState;
}

export function setCostume(state: ScapePlayerState, costume: Partial<VisualSignature>): void {
  state.body.costume = { ...state.body.costume, ...costume };
}

export function setHigh(state: ScapePlayerState, intensity: number): void {
  const h = state.body.high;
  const next = clamp(intensity, 0, 1);
  h.rising = next > h.intensity + 1e-4;
  h.intensity = next;
  recomputeHigh(h);
}

export function increaseHigh(state: ScapePlayerState, substanceKey?: string): void {
  const h = state.body.high;
  h.sinceMs = 0;
  if (substanceKey) h.substanceKey = substanceKey;
  setHigh(state, h.intensity + 0.45);
  h.rising = true; // a fresh dose is unambiguously a come-up
  recomputeHigh(h);
}
