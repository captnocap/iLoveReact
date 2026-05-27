// AchievementsListener — invisible component that mounts every
// achievement's useIFTTT binding. Bridges the sim IFTTT bus into the
// achievement progress/unlock helpers.
//
// SHAPE PASS: 4 starter achievements wired end-to-end (FirstTrade,
// 100Trades, Millionaire, Bankrupt). FirstHarvest awaits a
// staking-emit-on-harvest event; DiamondHands awaits a richer rug
// observation surface (token holdings at rug time). Both stubs are
// commented below for follow-up.

import { useEffect } from 'react';
import { useIFTTT } from '../../../../../runtime/hooks/useIFTTT';
import {
  setActivePlayer, progress, unlock,
  ACH_FIRST_TRADE, ACH_100_TRADES, ACH_MILLIONAIRE, ACH_BANKRUPT,
} from '../../../achievements';
import { usePlayerAddress } from '../../../sim';

export function AchievementsListener() {
  const addr = usePlayerAddress();

  // Activate the current player's achievement scope. Player address is
  // OS CSPRNG and changes per run, so this fires on every new run.
  useEffect(() => {
    setActivePlayer(addr ?? null);
  }, [addr]);

  // === Bindings ===
  // Each useIFTTT call is a (trigger, action) pair. The triggers are
  // string DSL specs registered in ifttt_sim.ts.

  useIFTTT('sim:trade:executed', () => {
    progress(ACH_FIRST_TRADE, 1);
    progress(ACH_100_TRADES, 1);
  });

  useIFTTT('sim:wallet:milestone:1000000', () => {
    unlock(ACH_MILLIONAIRE);
  });

  useIFTTT('sim:wallet:bankrupted', () => {
    unlock(ACH_BANKRUPT);
  });

  // === Future bindings (need extra sim emits) ===
  //
  // useIFTTT('sim:staking:harvested', () => unlock(ACH_FIRST_HARVEST));
  //   → needs Zig to emit 'sim:staking' on harvest. SHAPE PASS leaves
  //     it commented; lands when staking_mod gains an emit-on-harvest.
  //
  // useIFTTT(
  //   { all: ['sim:rug:any', () => sim.holdingUsd(rugged) >= 10_000] },
  //   () => unlock(ACH_DIAMOND_HANDS),
  // );
  //   → needs sim:rug:any (Zig emit at rug fire) + holdingUsd helper.

  return null;
}
