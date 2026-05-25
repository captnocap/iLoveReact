import type { Cam } from '../world/projection';
import type { EvidenceAxis, LifeState, Player, Suspicion, Tile, VisualSignature } from '../design';

export type PathStep = { x: number; y: number };

export type ScapePlayerState = Cam & {
  body: Player;
  path: PathStep[];
};

export const PLAYER_SPEED = 4.2;

const SUSPICION_AXES: EvidenceAxis[] = ['visual', 'fund', 'pattern', 'digital', 'location'];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function zeroSuspicion(): Suspicion {
  return { visual: 0, fund: 0, pattern: 0, digital: 0, location: 0 };
}

function defaultCostume(): VisualSignature {
  return { silhouette: 'avg', color: '#2e6da4', accessory: 'none' };
}

function tileFromPosition(px: number, py: number): Tile {
  return { x: Math.floor(px), y: Math.floor(py) };
}

export function suspicionMagnitude(suspicion: Suspicion): number {
  let sum = 0;
  for (const axis of SUSPICION_AXES) sum += suspicion[axis] * suspicion[axis];
  return clamp(Math.sqrt(sum / SUSPICION_AXES.length), 0, 100);
}

export function syncPlayerBody(state: ScapePlayerState): void {
  state.body.tile = tileFromPosition(state.px, state.py);
  state.body.notoriety = suspicionMagnitude(state.body.suspicion);
}

export function createInitialPlayerBody(tile: Tile, facing: number): Player {
  return {
    tile,
    facing,
    health: 100,
    maxHealth: 100,
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
    high: 0,
  };
}

export function createInitialPlayerState(): ScapePlayerState {
  const px = 22.5;
  const py = 24.5;
  const facing = -Math.PI / 2;
  const state = {
    px: 22.5,
    py: 24.5,
    yaw: Math.PI * 0.25,
    pitch: 0.62,
    zoom: 1.1,
    body: createInitialPlayerBody(tileFromPosition(px, py), facing),
    path: [],
  };
  syncPlayerBody(state);
  return state;
}

export function advancePlayer(state: ScapePlayerState, dt: number): void {
  setHigh(state, state.body.high - 0.12 * dt);
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

export function adjustMoney(state: ScapePlayerState, delta: number): void {
  state.body.money = Math.max(0, Math.round(state.body.money + delta));
}

export function setSuspicionAxis(state: ScapePlayerState, axis: EvidenceAxis, value: number): void {
  state.body.suspicion[axis] = clamp(Math.round(value), 0, 100);
  state.body.notoriety = suspicionMagnitude(state.body.suspicion);
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

export function setHigh(state: ScapePlayerState, high: number): void {
  state.body.high = clamp(high, 0, 1);
}

export function increaseHigh(state: ScapePlayerState): void {
  setHigh(state, state.body.high + 0.45);
}
