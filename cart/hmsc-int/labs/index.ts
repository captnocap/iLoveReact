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

// rjit:lab-imports — `rjit lab new` inserts imports above this line. Keep this marker.

export const LABS: LabEntry[] = [
  // rjit:lab-entries — `rjit lab new` inserts entries above this line. Keep this marker.
];
