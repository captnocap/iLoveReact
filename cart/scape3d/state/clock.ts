// The in-game clock. GTA III cadence: roughly one game-minute per real-second, so
// a full day runs ~24 real minutes. The HUD reads it as HH:MM; later the daily
// system (NPC routines, market ticks, the investigation lagging reality) keys off
// the same minutes. We start at dusk — the world is a neon-dusk city (TONE.md).

export type GameClock = { minutes: number }; // total in-game minutes since day 0 (fractional)

export const MINUTES_PER_SECOND = 1;
export const START_HOUR = 20;

export function createClock(startHour: number = START_HOUR): GameClock {
  return { minutes: startHour * 60 };
}

export function advanceClock(clock: GameClock, dtSec: number): void {
  clock.minutes += dtSec * MINUTES_PER_SECOND;
}

export function clockHM(clock: GameClock): { hour: number; minute: number } {
  const total = Math.floor(clock.minutes);
  return { hour: Math.floor(total / 60) % 24, minute: ((total % 60) + 60) % 60 };
}

export function formatClock(clock: GameClock): string {
  const { hour, minute } = clockHM(clock);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
