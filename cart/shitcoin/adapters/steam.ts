// Steam adapter — stub.
//
// When/if we ship on Steam, this file becomes the only thing that
// knows about Steamworks. Internal achievement IDs map to Steam
// achievement strings; we subscribe to `onUnlock` and forward.
//
// For now, the SDK isn't linked into the binary and this file is dead
// code. Importing it has zero effect. The `STEAM_ID_MAP` below is the
// stable contract — when a real Steamworks integration lands, IT pulls
// THIS map, not the other way around.

import { onUnlock, type AchievementId } from '../achievements';
import {
  ACH_FIRST_TRADE, ACH_100_TRADES, ACH_FIRST_HARVEST,
  ACH_MILLIONAIRE, ACH_DIAMOND_HANDS, ACH_BANKRUPT,
  ACH_PAPER_HANDS, ACH_FIRST_BOT_BUY,
} from '../achievements';

/** Internal id → Steam achievement key. Steam keys are author-stable
 *  strings; never rename one after a public release. */
export const STEAM_ID_MAP: Record<AchievementId, string> = {
  [ACH_FIRST_TRADE]:   'ACH_FIRST_TRADE',
  [ACH_100_TRADES]:    'ACH_100_TRADES',
  [ACH_FIRST_HARVEST]: 'ACH_FIRST_HARVEST',
  [ACH_MILLIONAIRE]:   'ACH_MILLIONAIRE',
  [ACH_DIAMOND_HANDS]: 'ACH_DIAMOND_HANDS',
  [ACH_BANKRUPT]:      'ACH_BANKRUPT',
  [ACH_PAPER_HANDS]:   'ACH_PAPER_HANDS',
  [ACH_FIRST_BOT_BUY]: 'ACH_FIRST_BOT_BUY',
};

/** Stub: called by future build flag wiring. Until Steamworks is
 *  linked, this just exists to document the integration point. */
export function initSteamAdapter(): () => void {
  // Real impl:
  //   const steam = require('steamworks');
  //   return onUnlock((id) => {
  //     const key = STEAM_ID_MAP[id];
  //     if (key) steam.setAchievement(key);
  //   });
  return onUnlock(() => { /* noop until Steamworks is linked */ });
}
