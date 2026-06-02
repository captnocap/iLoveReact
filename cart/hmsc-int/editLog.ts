// editLog.ts — the editor's semantic event trace (an eventbus for the shell's log).
//
// Every meaningful edit emits an EditNote describing WHAT happened (a category +
// a human line), instead of the old useless "saved" spam. The cart collects them
// into a capped ring of EditEvents (note + timestamp) shown in the ProjectBar's
// log popover. Categories drive the row colour so the trace is scannable at a glance.

export type EditCategory =
  | 'tile'    // painting / erasing the tile layer
  | 'height'  // sculpting the heightfield
  | 'zone'    // zone paint / add / remove
  | 'chunk'   // adding a chunk to the map
  | 'object'  // placements: add / move / rotate / clone / remove / lock
  | 'camera'  // the 3D preview free-fly camera
  | 'map';    // map lifecycle: open / new / rename / delete

// What an edit site emits. The cart stamps the time when it lands in the log.
export interface EditNote {
  cat: EditCategory;
  text: string;
}

export interface EditEvent extends EditNote {
  t: number; // Date.now() when logged
}

export const CAT_COLOR: Record<EditCategory, string> = {
  tile: '#86efac',
  height: '#fbbf24',
  zone: '#22d3ee',
  chunk: '#a78bfa',
  object: '#f472b6',
  camera: '#7dd3fc',
  map: '#94a3b8',
};

// Short uppercase tag shown beside each row.
export const CAT_TAG: Record<EditCategory, string> = {
  tile: 'TILE',
  height: 'HGHT',
  zone: 'ZONE',
  chunk: 'CHNK',
  object: 'OBJ',
  camera: 'CAM',
  map: 'MAP',
};

export function relTime(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 2) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}
