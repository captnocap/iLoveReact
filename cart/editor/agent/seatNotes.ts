// editor/agent/seatNotes.ts — cross-context handoff memory for the Agent Seat.
//
// Notes and the class corpus are two systems with OPPOSITE requirements, and mixing
// them is how a corpus fills with noise. Notes are cheap, mutable, disposable — a
// scratch pad an agent leaves for whoever picks the model up next. The corpus
// (seatClassSpec.ts) is curated, measured, and permanent. Nothing here is ever
// promoted into that one automatically.
//
// Two disciplines make notes useful instead of a stale-context trap:
//
//   1. A note records INTENT, never a fact the percept can answer. "Hood bbox is
//      1.2 m" is poison: three edits later the next agent still trusts it. "User wants
//      the hood asymmetric, do not mirror it" is exactly right — it is the one thing
//      `look` can never tell a cold agent. The phase docs enforce this; the shape here
//      only makes the distinction expressible.
//   2. Every note is stamped with the mesh generation it was written at, so a reader
//      can tell what has moved underneath it. Decisions stay durable — intent does not
//      expire because geometry changed. Observations and todos go SUSPECT the moment
//      the mesh advances, the same three-horizon honesty semantic-status uses.

export const SEAT_NOTE_KINDS = ['decision', 'observation', 'todo'] as const;
export type SeatNoteKind = (typeof SEAT_NOTE_KINDS)[number];

export type SeatNote = {
  id: number;
  at: string;
  /** percept.generation when the note was written. */
  generation: number;
  kind: SeatNoteKind;
  phase: string | null;
  agent: string | null;
  text: string;
};

export type SeatNoteBook = {
  version: 1;
  model: string | null;
  nextId: number;
  notes: SeatNote[];
};

/** Notes are disposable by design. Past this the oldest OBSERVATIONS and todos are
 *  dropped first — a decision is the thing a cold agent actually needs, so it survives
 *  a full pad while a stale observation does not. */
export const NOTE_BOOK_LIMIT = 60;
export const NOTE_TEXT_LIMIT = 400;

export function emptyNoteBook(model: string | null): SeatNoteBook {
  return { version: 1, model, nextId: 1, notes: [] };
}

export function isNoteBook(value: unknown): value is SeatNoteBook {
  const book = value as SeatNoteBook | null;
  return !!book && book.version === 1 && Array.isArray(book.notes) && typeof book.nextId === 'number';
}

export function parseNoteKind(value: unknown): SeatNoteKind | null {
  const text = String(value ?? 'observation').toLowerCase();
  return (SEAT_NOTE_KINDS as readonly string[]).includes(text) ? text as SeatNoteKind : null;
}

export type NoteAppend = { book: SeatNoteBook; note: SeatNote; dropped: number };

export function appendNote(
  book: SeatNoteBook,
  input: { text: string; kind: SeatNoteKind; generation: number; phase?: string | null; agent?: string | null; at: string },
): NoteAppend | { reason: string } {
  const text = String(input.text ?? '').trim();
  if (!text) return { reason: 'a note needs text — say the INTENT the percept cannot answer' };
  if (text.length > NOTE_TEXT_LIMIT) {
    return { reason: `a note is ${text.length} characters; keep it under ${NOTE_TEXT_LIMIT} — notes are a handoff line, not a report` };
  }
  const note: SeatNote = {
    id: book.nextId,
    at: input.at,
    generation: input.generation,
    kind: input.kind,
    phase: input.phase ?? null,
    agent: input.agent ?? null,
    text,
  };
  const notes = [...book.notes, note];
  const dropped = trimToLimit(notes);
  return { book: { ...book, nextId: book.nextId + 1, notes }, note, dropped };
}

/** Drop oldest non-decisions first, and only fall back to dropping decisions when a pad
 *  somehow contains nothing else. */
function trimToLimit(notes: SeatNote[]): number {
  let dropped = 0;
  while (notes.length > NOTE_BOOK_LIMIT) {
    const at = notes.findIndex((note) => note.kind !== 'decision');
    notes.splice(at >= 0 ? at : 0, 1);
    dropped += 1;
  }
  return dropped;
}

export function dropNote(book: SeatNoteBook, id: number): SeatNoteBook | { reason: string } {
  if (!book.notes.some((note) => note.id === id)) return { reason: `no note ${id} on this model` };
  return { ...book, notes: book.notes.filter((note) => note.id !== id) };
}

export type SeatNoteView = SeatNote & {
  /** True when the mesh has moved since the note was written AND the note is the kind
   *  whose meaning depends on the mesh. A decision is intent and never goes stale. */
  stale: boolean;
  generationsAgo: number;
};

export function viewNotes(book: SeatNoteBook, currentGeneration: number): SeatNoteView[] {
  return book.notes.map((note) => {
    const generationsAgo = Math.max(0, currentGeneration - note.generation);
    return { ...note, generationsAgo, stale: note.kind !== 'decision' && generationsAgo > 0 };
  });
}

export type SeatNoteSummary = {
  total: number;
  decisions: number;
  suspect: number;
  /** What a cold agent should read first: durable intent, newest last. */
  notes: SeatNoteView[];
};

export function summarizeNotes(book: SeatNoteBook, currentGeneration: number): SeatNoteSummary {
  const notes = viewNotes(book, currentGeneration);
  return {
    total: notes.length,
    decisions: notes.filter((note) => note.kind === 'decision').length,
    suspect: notes.filter((note) => note.stale).length,
    notes,
  };
}
