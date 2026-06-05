// game/items/ — GAME_ITEMS: the items registry + models (V11). CAPTURE PENDING.
//
// game_item_gallery's ITEMS concepts are the source; every model owes the
// mandatory scale audit against 1 tile = 1m (R5: "the boat is smaller than the
// player model's hand"). physics_lab's catalog folds in after review. Door
// only, nothing fake.

export const GAME_ITEMS = Object.freeze({
  status: 'capture-pending' as const,
});
