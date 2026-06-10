// Collision-proof sequential id allocator for user-placed world entities.
//
// The old `${prefix}${list.length + 1}` scheme REISSUED a live id after a
// removal: place 3 buildings (building_user_1..3), remove building_user_2, then
// place again — length is 2, so the "new" id is building_user_3, a duplicate of
// the survivor. Two entities sharing an id breaks every id lookup (face-skin
// edits, remove, enter) and any tool that loads an entity by id.
//
// `nextUniqueId` instead walks up from 1 to the first id NOT already taken, so
// an id is never handed out while its holder is alive. Ids stay short and
// human-typeable (building_user_4), and a removed id is reused only once nothing
// holds it — exactly what "an id that can't overlap" needs.
export function nextUniqueId(prefix: string, existing: Iterable<string>): string {
  const taken = existing instanceof Set ? existing : new Set(existing);
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}
