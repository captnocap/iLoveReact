// The X-COM percent-to-hit engine — GROUND TRUTH for any attack. Given a weapon's
// ballistics, the distance, the line of sight, and the shooter's condition, it
// returns a legible ChanceBreakdown (each factor is a multiplier on base; `final`
// is their clamped product). The menu shows WHY a shot is 33%. What it DISPLAYS may
// be warped under high — that lie lives in systems/perception.ts and never touches
// these numbers.

import type { ChanceBreakdown, LosQuality, RangeProfile } from '../design';
import { cityPropAt, cityTileAt } from '../world/citymap';
import { Kind } from '../world/tiles';

const VOID = -1;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// A wall tile is a window candidate (you could shoot THROUGH it as glass) only if it
// faces open space — a facade, not the solid interior of a block.
function isFacadeWall(x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const k = cityTileAt(x + dx, y + dy);
    if (k !== Kind.Wall && k !== VOID) return true;
  }
  return false;
}

// Line of sight from shooter to target across the tile grid. Supersamples the
// segment, classifies each intervening tile, and folds them into one quality:
//   clear   — nothing between
//   partial — a prop (dumpster/sign/palm) gives the target cover
//   glass   — exactly one facade wall between (a window shot, penalised)
//   none    — a solid wall / closed door / deep building blocks it (no shot)
export function lineOfSight(px: number, py: number, tx: number, ty: number, closedDoors: Set<string>): LosQuality {
  const dx = tx - px;
  const dy = ty - py;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  const startKey = `${Math.floor(px)},${Math.floor(py)}`;
  const targetKey = `${Math.floor(tx)},${Math.floor(ty)}`;
  const seen = new Set<string>();
  let walls = 0;
  let windowWall = false;
  let cover = false;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const gx = Math.floor(px + dx * t);
    const gy = Math.floor(py + dy * t);
    const key = `${gx},${gy}`;
    if (key === startKey || key === targetKey || seen.has(key)) continue;
    seen.add(key);
    const k = cityTileAt(gx, gy);
    if (k === Kind.Wall) {
      walls++;
      if (isFacadeWall(gx, gy)) windowWall = true;
    } else if (k === Kind.Door && closedDoors.has(key)) {
      walls++; // a shut door is opaque — never glass
    } else if (cityPropAt(gx, gy)) {
      cover = true;
    }
  }
  if (walls === 0) return cover ? 'partial' : 'clear';
  if (walls === 1 && windowWall) return 'glass';
  return 'none';
}

export type AttackCtx = {
  combat: number; // player combat skill 0..1
  health01: number; // current health fraction 0..1
  hour: number; // 0..23 — drives the night sight penalty
  awareness: 'unaware' | 'alert' | 'fleeing';
};

// los multiplier by quality (partial is handled as COVER below, not here).
const LOS_MULT: Record<LosQuality, number> = { clear: 1, glass: 0.5, partial: 1, none: 0 };

function awarenessMult(a: AttackCtx['awareness']): number {
  return a === 'unaware' ? 1.15 : a === 'alert' ? 0.7 : 0.5;
}

function timeMult(hour: number, ranged: boolean): number {
  if (!ranged) return 1; // melee doesn't care about the dark
  const night = hour >= 20 || hour < 6;
  return night ? 0.82 : 1;
}

function healthMult(h01: number): number {
  return 0.7 + 0.3 * clamp(h01, 0, 1); // low HP = shaky aim
}

// Build the full breakdown. `ranged` weapons use the RangeProfile (falloff, glass
// penalty, maxRange, LoS); melee ignores LoS/range past adjacency. A shot with no
// line of sight or out of max range resolves to 0 (the menu greys it).
export function attackChance(
  profile: RangeProfile | null,
  ranged: boolean,
  dist: number,
  los: LosQuality,
  ctx: AttackCtx,
): ChanceBreakdown {
  const base = profile ? profile.baseAccuracy : 0.6;

  let range = 1;
  let unavailable = false;
  if (ranged && profile) {
    if (dist > profile.maxRange) {
      unavailable = true;
      range = 0;
    } else {
      range = clamp(1 - Math.abs(dist - profile.optimalRange) * profile.falloffPerTile, 0.2, 1);
    }
  } else {
    range = dist <= 1.8 ? 1 : 0; // melee: adjacency (also proximity-gated upstream)
  }

  const losMult = !ranged ? 1 : los === 'glass' && profile ? profile.glassPenalty : LOS_MULT[los];
  const cover = los === 'partial' ? 0.65 : 1;
  const awareness = awarenessMult(ctx.awareness);
  const health = healthMult(ctx.health01);
  const time = timeMult(ctx.hour, ranged);
  const skill = 0.6 + ctx.combat * 0.8;

  let final = base * range * losMult * cover * awareness * health * time * skill;
  if (unavailable || (ranged && los === 'none')) final = 0;
  final = final <= 0 ? 0 : clamp(final, 0.02, 0.98);

  return { base, range, los: losMult, cover, awareness, health, time, skill, final };
}
