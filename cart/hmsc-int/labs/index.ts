// labs/index.ts — the lab registry: every lab, instantly loadable (V13).
//
// `rjit lab new <name>` maintains this file: it inserts one import and one
// LABS entry at the markers below. Hand-edit only to retire a lab. The labs
// route renders this list — entries cross into shell/ as plain data, so shell
// stays game-agnostic (STRUCTURE's import rules: shell/ → nothing
// game-specific; labs/ → game/ only).

import type { ComponentType } from 'react';

export type LabEntry = {
  /** kebab-case lab name — always the file stem */
  name: string;
  /** the lab's exported scene (labs export themselves; nothing else) */
  Component: ComponentType;
  /** repo-relative path to the paired notes (P6 — always surfaced beside the lab) */
  notesPath: string;
};

import VehicleHandling from './vehicle-handling';
import PlayerStats from './player-stats';
import CombatArena from './combat-arena';
import Explosives from './explosives';
// rjit:lab-imports — `rjit lab new` inserts imports above this line. Keep this marker.

export const LABS: LabEntry[] = [
  { name: 'vehicle-handling', Component: VehicleHandling, notesPath: 'cart/hmsc-int/labs/vehicle-handling.notes.md' },
  { name: 'player-stats', Component: PlayerStats, notesPath: 'cart/hmsc-int/labs/player-stats.notes.md' },
  { name: 'combat-arena', Component: CombatArena, notesPath: 'cart/hmsc-int/labs/combat-arena.notes.md' },
  { name: 'explosives', Component: Explosives, notesPath: 'cart/hmsc-int/labs/explosives.notes.md' },
  // rjit:lab-entries — `rjit lab new` inserts entries above this line. Keep this marker.
];
