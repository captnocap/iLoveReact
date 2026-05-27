// StakingPool — reusable yield-farm card. Mirrors a Pancake "Syrup
// Pool" / Sushi "Kashi" UI shape: APR, total locked, my stake, my
// earned + harvest, lock countdown.

import { useState, useMemo } from 'react';
import { classifiers as C } from '../../../../runtime/classifier';
import { sim, useStakingPool, useWallet } from '../../sim';
import './StakingPool.cls';

export interface StakingPoolProps {
  poolId: number;
}

function compactUsd(v: number): string {
  if (!isFinite(v) || v <= 0) return '$0';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
  return '$' + v.toFixed(2);
}

function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

function lockTimeRemaining(unlockEndMs: number, realMs: number): string {
  const rem = unlockEndMs - realMs;
  if (rem <= 0) return 'Unlocked';
  const secs = Math.floor(rem / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${pad2(s)} remaining`;
}

export function StakingPool({ poolId }: StakingPoolProps) {
  const pool = useStakingPool(poolId);
  const wallet = useWallet();
  const [stakeInput, setStakeInput] = useState('100');
  const [unstakeInput, setUnstakeInput] = useState('');

  const realMs = sim.realTimeMs();
  const isLocked = pool ? !pool.unlocked && pool.myStake > 0 : false;
  const lockLine = pool && pool.lockMs > 0 && pool.myStake > 0
    ? lockTimeRemaining(pool.lockEndMs, realMs)
    : null;

  const stakeNum = parseFloat(stakeInput) || 0;
  const unstakeNum = parseFloat(unstakeInput) || 0;

  const canStake = useMemo(() => {
    if (!pool || stakeNum <= 0) return false;
    // For USDT pools, cap by wallet.usd; for token pools, by holding.
    if (pool.stakedSym === 'USDT') return (wallet?.usd ?? 0) >= stakeNum;
    const h = wallet?.holdings.find((x) => x.id === pool.stakedTokenId);
    return (h?.amt ?? 0) >= stakeNum;
  }, [pool, wallet, stakeNum]);

  const canUnstake = !!pool && unstakeNum > 0 && unstakeNum <= pool.myStake && !isLocked;
  const canHarvest = !!pool && pool.myEarned > 0;

  if (!pool) {
    return (
      <C.StakingPoolRoot>
        <C.StakingPoolName>Pool {poolId}</C.StakingPoolName>
        <C.StakingPoolMetricLabel>waiting…</C.StakingPoolMetricLabel>
      </C.StakingPoolRoot>
    );
  }

  const onStake = () => {
    if (canStake) sim.stake(poolId, stakeNum);
  };
  const onUnstake = () => {
    if (canUnstake) sim.unstake(poolId, unstakeNum);
  };
  const onHarvest = () => {
    if (canHarvest) sim.harvest(poolId);
  };

  return (
    <C.StakingPoolRoot>
      <C.StakingPoolHeader>
        <C.StakingPoolName>{pool.name}</C.StakingPoolName>
        <C.StakingPoolBadge>
          <C.StakingPoolBadgeText>{pool.stakedSym} → {pool.rewardSym}</C.StakingPoolBadgeText>
        </C.StakingPoolBadge>
      </C.StakingPoolHeader>

      {pool.vested ? (
        <C.StakingPoolMetricsRow>
          <C.StakingPoolMetricLabel>Vested · survives reset</C.StakingPoolMetricLabel>
          <C.StakingPoolMetricValue>cap {compactUsd(pool.vestedCap)}</C.StakingPoolMetricValue>
        </C.StakingPoolMetricsRow>
      ) : null}

      <C.StakingPoolMetricsRow>
        <C.StakingPoolMetricLabel>APR</C.StakingPoolMetricLabel>
        <C.StakingPoolApr>{(pool.apr * 100).toFixed(1)}%</C.StakingPoolApr>
      </C.StakingPoolMetricsRow>

      <C.StakingPoolMetricsRow>
        <C.StakingPoolMetricLabel>Total staked</C.StakingPoolMetricLabel>
        <C.StakingPoolMetricValue>{compactUsd(pool.totalStaked)}</C.StakingPoolMetricValue>
      </C.StakingPoolMetricsRow>

      <C.StakingPoolMetricsRow>
        <C.StakingPoolMetricLabel>My stake</C.StakingPoolMetricLabel>
        <C.StakingPoolMetricValue>{compactUsd(pool.myStake)} {pool.stakedSym}</C.StakingPoolMetricValue>
      </C.StakingPoolMetricsRow>

      {lockLine ? (
        <C.StakingPoolLockHint>{lockLine}</C.StakingPoolLockHint>
      ) : null}

      <C.StakingPoolDivider />

      <C.StakingPoolEarnedBlock>
        <C.StakingPoolMetricLabel>Earned ({pool.rewardSym})</C.StakingPoolMetricLabel>
        <C.StakingPoolEarnedAmount>{pool.myEarned.toFixed(6)}</C.StakingPoolEarnedAmount>
        {canHarvest ? (
          <C.StakingPoolActionBtn onPress={onHarvest}>
            <C.StakingPoolActionText>Harvest</C.StakingPoolActionText>
          </C.StakingPoolActionBtn>
        ) : (
          <C.StakingPoolActionBtnDisabled>
            <C.StakingPoolActionTextAlt>Harvest</C.StakingPoolActionTextAlt>
          </C.StakingPoolActionBtnDisabled>
        )}
      </C.StakingPoolEarnedBlock>

      <C.StakingPoolInputRow>
        <C.StakingPoolInputField value={stakeInput} onChangeText={(v: string) => setStakeInput(v)} />
        {canStake ? (
          <C.StakingPoolActionBtn onPress={onStake}>
            <C.StakingPoolActionText>Stake</C.StakingPoolActionText>
          </C.StakingPoolActionBtn>
        ) : (
          <C.StakingPoolActionBtnDisabled>
            <C.StakingPoolActionTextAlt>Stake</C.StakingPoolActionTextAlt>
          </C.StakingPoolActionBtnDisabled>
        )}
      </C.StakingPoolInputRow>

      {pool.myStake > 0 ? (
        <C.StakingPoolInputRow>
          <C.StakingPoolInputField value={unstakeInput} onChangeText={(v: string) => setUnstakeInput(v)} />
          {canUnstake ? (
            <C.StakingPoolActionBtnAlt onPress={onUnstake}>
              <C.StakingPoolActionTextAlt>Unstake</C.StakingPoolActionTextAlt>
            </C.StakingPoolActionBtnAlt>
          ) : (
            <C.StakingPoolActionBtnDisabled>
              <C.StakingPoolActionTextAlt>Unstake</C.StakingPoolActionTextAlt>
            </C.StakingPoolActionBtnDisabled>
          )}
        </C.StakingPoolInputRow>
      ) : null}
    </C.StakingPoolRoot>
  );
}
