// achievements — per-player unlock tracker with JSON persistence.
//
// The list of achievements is authored here (id + label + description
// + target). Progress + unlock state are tracked in-memory + persisted
// to `./shitcoin_achievements.json` keyed by the player's wallet
// address (so multiple players on the same machine don't collide).
//
// Achievements ARE NOT tied to a specific run — they're forever, like
// Steam. sim.reset() does not clear them. The Steam adapter in
// `adapters/steam.ts` is a stub today; when we ship on Steam we
// register a listener here that maps id → Steam achievement string.

import { readFile, writeFile } from '../../runtime/hooks/fs.ts';

export type AchievementId = number;

export interface Achievement {
  id: AchievementId;
  name: string;
  description: string;
  /** Total progress required. `target=1` for one-shot achievements. */
  target: number;
  /** Hidden until unlocked. */
  hidden?: boolean;
}

// Achievement IDs are stable integers. NEVER reassign — Steam-adapter
// mapping depends on them.
export const ACH_FIRST_TRADE = 1;
export const ACH_100_TRADES = 2;
export const ACH_FIRST_HARVEST = 3;
export const ACH_MILLIONAIRE = 4;
export const ACH_DIAMOND_HANDS = 5;
export const ACH_BANKRUPT = 6;
export const ACH_PAPER_HANDS = 7;
export const ACH_FIRST_BOT_BUY = 8;

export const ACHIEVEMENTS: Achievement[] = [
  { id: ACH_FIRST_TRADE,   name: 'First Trade',   description: 'Execute any swap.',                target: 1 },
  { id: ACH_100_TRADES,    name: '100 Trades',    description: 'Cumulative 100 player trades.',   target: 100 },
  { id: ACH_FIRST_HARVEST, name: 'First Harvest', description: 'Collect rewards from a staking pool.', target: 1 },
  { id: ACH_MILLIONAIRE,   name: 'Millionaire',   description: 'Reach a total wallet value of $1,000,000.', target: 1 },
  { id: ACH_DIAMOND_HANDS, name: 'Diamond Hands', description: 'Survive a rug while holding > $10k of the rugged token.', target: 1, hidden: true },
  { id: ACH_BANKRUPT,      name: 'Bankrupt',      description: 'Drop to $10 or less of total value.', target: 1 },
  { id: ACH_PAPER_HANDS,   name: 'Paper Hands',   description: 'Sell within 5 seconds of buying the same token.', target: 1, hidden: true },
  { id: ACH_FIRST_BOT_BUY, name: 'Hands-Free',    description: 'Execute a trade via the sniper bot.', target: 1 },
];

const _achById = new Map<AchievementId, Achievement>();
for (const a of ACHIEVEMENTS) _achById.set(a.id, a);

// ── Save shape ────────────────────────────────────────────────────────

interface SavedState {
  version: 1;
  perPlayer: Record<string, PlayerState>;
}

interface PlayerState {
  progress: Record<number, number>;
  unlocked: Array<{ id: number; ms: number }>;
}

const SAVE_PATH = './shitcoin_achievements.json';

let _state: SavedState = { version: 1, perPlayer: {} };
let _loaded = false;
let _activeAddress: string | null = null;
const _unlockListeners = new Set<(id: AchievementId) => void>();

function load(): void {
  if (_loaded) return;
  _loaded = true;
  const raw = readFile(SAVE_PATH);
  if (raw == null) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && parsed.perPlayer) {
      _state = parsed as SavedState;
    }
  } catch {
    // Corrupt save — leave default state, fresh writes will overwrite.
  }
}

function save(): void {
  try { writeFile(SAVE_PATH, JSON.stringify(_state)); } catch {}
}

function playerEntry(addr: string): PlayerState {
  let p = _state.perPlayer[addr];
  if (!p) {
    p = { progress: {}, unlocked: [] };
    _state.perPlayer[addr] = p;
  }
  return p;
}

// ── Public surface ───────────────────────────────────────────────────

/** Call once on cart boot + every time the player address changes
 *  (e.g. after sim.reset() since the player wallet is OS CSPRNG and
 *  globally unique per run). */
export function setActivePlayer(address: string | null): void {
  load();
  _activeAddress = address;
}

export function progress(id: AchievementId, delta: number): void {
  if (!_activeAddress) return;
  const a = _achById.get(id);
  if (!a) return;
  const p = playerEntry(_activeAddress);
  const prev = p.progress[id] ?? 0;
  if (prev >= a.target) return;  // already unlocked
  const next = prev + delta;
  p.progress[id] = next;
  if (next >= a.target) {
    p.unlocked.push({ id, ms: Date.now() });
    fireUnlock(id);
  }
  save();
}

export function unlock(id: AchievementId): void {
  if (!_activeAddress) return;
  const a = _achById.get(id);
  if (!a) return;
  const p = playerEntry(_activeAddress);
  const already = (p.progress[id] ?? 0) >= a.target;
  if (already) return;
  p.progress[id] = a.target;
  p.unlocked.push({ id, ms: Date.now() });
  fireUnlock(id);
  save();
}

export function isUnlocked(id: AchievementId): boolean {
  if (!_activeAddress) return false;
  const p = _state.perPlayer[_activeAddress];
  if (!p) return false;
  const a = _achById.get(id);
  if (!a) return false;
  return (p.progress[id] ?? 0) >= a.target;
}

export function getProgress(id: AchievementId): number {
  if (!_activeAddress) return 0;
  const p = _state.perPlayer[_activeAddress];
  if (!p) return 0;
  return p.progress[id] ?? 0;
}

export function onUnlock(fn: (id: AchievementId) => void): () => void {
  _unlockListeners.add(fn);
  return () => { _unlockListeners.delete(fn); };
}

function fireUnlock(id: AchievementId): void {
  for (const fn of Array.from(_unlockListeners)) {
    try { fn(id); } catch {}
  }
}

export function getAchievement(id: AchievementId): Achievement | undefined {
  return _achById.get(id);
}
