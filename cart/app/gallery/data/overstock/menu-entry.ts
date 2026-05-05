import type { GalleryDataReference, JsonObject } from '../../types';

export type MenuEntry = {
  id: string;
  key: string;
  label: string;
  hint: string;
  glyph?: string;
  status?: 'idle' | 'live' | 'warn' | 'flag' | 'mute';
};

export const menuEntryMockData: MenuEntry[] = [
  { id: 'continue', key: '1', label: 'Continue', hint: 'Archive_77 · 02:18', glyph: '▶', status: 'live' },
  { id: 'new',      key: '2', label: 'New',      hint: 'Begin a session',   glyph: '+', status: 'idle' },
  { id: 'activity', key: '3', label: 'Activity', hint: '12 events',         glyph: '◉', status: 'idle' },
  { id: 'library',  key: '4', label: 'Library',  hint: '114 entries',       glyph: '☷', status: 'idle' },
  { id: 'friends',  key: '5', label: 'Friends',  hint: '4 online',          glyph: '◐', status: 'warn' },
  { id: 'settings', key: '6', label: 'Settings', hint: '—',                 glyph: '⚙', status: 'idle' },
  { id: 'quit',     key: '7', label: 'Quit',     hint: 'Sign out',          glyph: '⏻', status: 'mute' },
];

export const menuEntrySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'MenuEntry',
  description:
    'A single menu entry — the unit of content shared across every menu representation in the gallery (lists, dials, tiles, dossiers, terminals, etc.). Each tile binds the same set of entries, the form differs.',
  type: 'object',
  required: ['id', 'key', 'label', 'hint'],
  properties: {
    id:    { type: 'string',  description: 'Stable slug. Routing target.' },
    key:   { type: 'string',  description: 'Single-character keyboard shortcut.' },
    label: { type: 'string',  description: 'Display label.' },
    hint:  { type: 'string',  description: 'Secondary text shown beside or below the label.' },
    glyph: { type: 'string',  description: 'Optional one-character symbol used by glyph-led menus (dock, sigil, console).' },
    status: {
      type: 'string',
      enum: ['idle', 'live', 'warn', 'flag', 'mute'],
      description: 'Operational tone for status-flag layouts.',
    },
  },
};

export const menuEntryReferences: GalleryDataReference[] = [];
