# editors/sessions.ts — the route-scoped session history (V20)

THE USER'S RULING (their words): "the workspace session history and different
channels for the history... route specific session commit histories and then
sprinkle in the edit commits after each interaction so i can work while the
interface is being built around it."

## The shape

A route opens a SESSION on its concern channel; every authoring INTERACTION
appends one labeled edit-commit. The `sessions` stream records lifecycle only
(opened / committed / closed markers); content events keep landing in their
own concern stream, untouched. Everything rides the ONE global sequence
(data/index.ts), so:

- the history is cross-channel ordered for free,
- an interaction's undo point is its commit's log position (V20),
- "what did I do this session, on this route" = `sessionsOnRoute(state, route)`.

Two commit grades, so a route adopts at whatever depth its content has reached:

- `commit(event, label)` — the content event goes to the channel stream AND
  the marker records its position. Replayable content + a labeled undo point.
- `note(label)` — marker only, for routes whose content is not event-sourced
  yet. The history exists TODAY; content events join the same channel later
  by addition (V20 schema evolution — nothing to migrate).

## Who's wired (2026-06-04)

| route       | channel    | grade                | where                          |
|-------------|------------|----------------------|--------------------------------|
| `/vehicles` | `vehicles` | commit (full)        | VehiclesRoute garage seam      |
| `/` (map)   | `world`    | note (marker-only)   | index.tsx logEvent funnel — the workspace save path is UNTOUCHED |

## Adopting the layer (the characters lane's hand-off)

The roster (editors/characters/roster.ts) already appends to the
`characters` stream through `createRoster(editorStore())`. To join the
session history, the route makes three calls — no roster surgery required:

```ts
import { editorChannel } from '../store';
import { editorSessions } from '../sessions';
import { charactersStream } from '../../game/figure/stream';

// 1. once per route mount (the VehiclesRoute idiom — useMemo([]) + cleanup):
const session = editorSessions().open('/characters', editorChannel(charactersStream));
useEffect(() => () => session.close(), [session]);

// 2. per interaction, EITHER full grade — replace roster.save's append:
session.commit({ kind: 'authored', id, doc }, `${id}: sculpted chin`);
// ...OR keep roster.save as-is and sprinkle the marker beside it:
roster.save(id, doc); session.note(`${id}: sculpted chin`);
```

Notes for the adoption:
- `editorChannel(charactersStream)` and `createRoster(editorStore())` would
  BOTH call `defineStream('characters')` on the one store — whichever runs
  second throws. Either route the roster through `editorChannel` internally,
  or take the full-grade path and let `session.commit` replace the roster's
  append (it also materializes snapshots, same as roster.save).
- Labels are the user's session history — write them as the action
  ('chr-x: wardrobe → coat'), not the mechanism.
- Tests: `createSessionLog(scratchStore)` is the testable door, same split
  as `createRoster`. See editors/sessions.test.ts and
  editors/vehicles/roundtrip.test.ts for the idioms.

## The map editor's path to full grade

The `/` route's world content still saves through the workspace session files
(`sessions/<map>.session.json`) — the user's authoring lifeline, deliberately
untouched. Its session history is marker-only notes through the logEvent
funnel. When the editor's world goes event-sourced, the content events join
the SAME `world` channel by addition; the notes already recorded stay valid
forever (V20: old streams never break).

## Known cost (layer-wide, queued)

No `__fs_append` host binding yet — every append is read+concat+write, O(file
size). Fine at edit rate today; the binding is the queued bindings-lane
follow-up (see data/index.ts header). The sessions stream grows one line per
interaction, so it hits this ceiling first; nothing else changes when the
binding lands.
