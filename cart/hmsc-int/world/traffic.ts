import type { GameState, TrafficSignalPhase, Vec3, WorldProp } from '../design';
import { propKindDefinition } from '../game/kinds/props';

// The traffic-control layer: it turns a stop sign or traffic light into a live
// phase a vehicle can read, and answers the one question NPC vehicle pathing
// asks at a junction — "approaching from here, heading this way, must I yield?".
// Phase is a pure function of a steady clock, so nothing has to be ticked into
// game state every frame (the render reads the same clock to glow the lamp).

// Light timing, in seconds. stop == go + caution so two perpendicular flows
// tile one period exactly: while one axis runs go→caution, the cross axis is
// stopped, then they swap. The cross-axis light is simply offset half a period.
export const TRAFFIC_SIGNAL_CYCLE = {
  goSeconds: 7.5,
  cautionSeconds: 2.5,
  get stopSeconds(): number {
    return this.goSeconds + this.cautionSeconds;
  },
  get periodSeconds(): number {
    return this.goSeconds + this.cautionSeconds + this.stopSeconds;
  },
} as const;

// One steady clock shared by the render (lamp glow) and the pathing query, so a
// vehicle yields on exactly the phase the player sees lit. performance.now is
// present in the cart host (unlike requestAnimationFrame — see the no-RAF note).
export function trafficClockSeconds(): number {
  const host: any = globalThis;
  const now = host.performance?.now?.();
  return (Number.isFinite(now) ? now : Date.now()) / 1000;
}

// A light's facing yaw decides which lane it governs; the cross-street light at
// the same junction is laid a quarter turn away, so this maps facing onto a
// half-period offset and the two axes alternate. Anything within 45° of a
// north-south facing shares one phase; east-west shares the other.
function signalPhaseOffsetSeconds(yawDegrees: number): number {
  const axis = Math.round(yawDegrees / 90) % 2;
  return axis === 0 ? 0 : TRAFFIC_SIGNAL_CYCLE.periodSeconds / 2;
}

function freeRunningSignalPhase(prop: WorldProp, timeSeconds: number): TrafficSignalPhase {
  const cycle = TRAFFIC_SIGNAL_CYCLE;
  const t = (((timeSeconds + signalPhaseOffsetSeconds(prop.yawDegrees)) % cycle.periodSeconds) + cycle.periodSeconds) % cycle.periodSeconds;
  if (t < cycle.goSeconds) return 'go';
  if (t < cycle.goSeconds + cycle.cautionSeconds) return 'caution';
  return 'stop';
}

// The current phase of one traffic-control prop. A console override pins it; a
// stop sign is always 'stop'; a traffic light free-runs its cycle. Scenery
// props (trafficControl 'none') have no phase.
export function trafficSignalPhase(prop: WorldProp, timeSeconds: number): TrafficSignalPhase | null {
  const control = propKindDefinition(prop.kind).trafficControl;
  if (control === 'none') return null;
  if (prop.signalOverride) return prop.signalOverride;
  if (control === 'stopSign') return 'stop';
  return freeRunningSignalPhase(prop, timeSeconds);
}

// Yaw 0 faces -Z (north), matching the player/world facing convention. A
// vehicle drives toward a control prop's face, so the prop that governs it
// faces back against its heading.
function facingVector(yawDegrees: number): { x: number; z: number } {
  const yaw = yawDegrees * Math.PI / 180;
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export type VehicleSignalReading = {
  prop: WorldProp;
  phase: TrafficSignalPhase;
  distanceMeters: number;
  mustYield: boolean;
};

// The trigger NPC vehicle pathing calls: given where a vehicle is and where it
// is heading, return the nearest control prop it is driving toward within
// `lookaheadMeters`, its live phase, and whether the vehicle must yield (stop or
// caution). Returns null when the lane ahead is uncontrolled. Decoupled from the
// path graph on purpose — a red light is a runtime yield, not a blocked tile.
export function vehicleApproachSignal(
  state: GameState,
  position: Vec3,
  headingDegrees: number,
  lookaheadMeters: number,
  timeSeconds = trafficClockSeconds(),
): VehicleSignalReading | null {
  const heading = facingVector(headingDegrees);
  let best: VehicleSignalReading | null = null;
  for (const prop of state.world.props) {
    if (propKindDefinition(prop.kind).trafficControl === 'none') continue;
    const toX = prop.x - position.x;
    const toZ = prop.z - position.z;
    const distance = Math.hypot(toX, toZ);
    if (distance < 0.01 || distance > lookaheadMeters) continue;
    const ahead = (toX * heading.x + toZ * heading.z) / distance;
    if (ahead < 0.3) continue; // the prop is beside or behind the vehicle
    const facing = facingVector(prop.yawDegrees);
    const opposing = facing.x * heading.x + facing.z * heading.z;
    if (opposing > -0.3) continue; // the prop does not face this oncoming lane
    if (best && distance >= best.distanceMeters) continue;
    const phase = trafficSignalPhase(prop, timeSeconds) ?? 'go';
    best = { prop, phase, distanceMeters: distance, mustYield: phase !== 'go' };
  }
  return best;
}
