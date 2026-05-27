// sim — public hooks + cache layer.
//
// The HOT path (per-frame tape, prices, AMM, wallet, NPC roster) lives
// in framework/sim/*.zig and is reached via `__zig_call('sim', ...)`.
// COLD systems (staking, upgrades, mining, LP, favors, web, CEX, social,
// telegram, forums, news, alpha, reputation) live in sim_engine.ts and
// are ticked at a slow cadence here.
//
// Cart consumers see the same `sim.*` object + `useXxx()` hooks they
// always did — the split is invisible above this file.

import { useEffect, useState } from 'react';
import { emit, subscribe } from '../../runtime/ffi';
import { engine } from './sim_engine';

declare const globalThis: any;

function zigCall(fn: string, ...args: any[]): any {
  const host = globalThis as any;
  if (typeof host.__zig_call !== 'function') return null;
  return host.__zig_call('sim', fn, ...args);
}

// ── Types ──────────────────────────────────────────────────────────────

export type Pattern = 'crab'|'pump'|'dump'|'organic_up'|'organic_down'|'volatile'|'rug';
const PATTERN_NAMES: Pattern[] = ['crab', 'pump', 'dump', 'organic_up', 'organic_down', 'volatile', 'rug'];
const TREND_NAMES = ['bull', 'bear', 'crab'] as const;

export type PriceSample = {
  id: number; sym: string; p: number; t: number;
  pat: Pattern; rug: boolean; ath: number; atl: number;
  marketCapUsd: number;
  volumeUsd: number;
  liquidityUsd: number;
};
export type Market = { trend: 'bull'|'bear'|'crab'; vol: number; fg: number; trendAge: number };
export type GameTime = { realMs: number; day: number; hour: number; dayMs: number };
export type Holding = { id: number; sym: string; amt: number; avg: number; inv: number; upnl: number; rpnl: number };
export type Wallet = { usd: number; totalUsd: number; start: number; trades: number; holdings: Holding[] };
export type TradeResult = { ok: boolean; output: number; impact: number; fee: number; effective_price: number };
export type QuoteResult = { output: number; impact: number; fee: number; effective_price: number };
export type Trade = {
  seq: number;
  kind: 'buy' | 'sell';
  id: number;
  sym: string;
  base: number;
  usd: number;
  price: number;
  fee: number;
  impact: number;
  t: number;
  realMs: number;
};
export const STAKING_ASSET_USDT = 4_294_967_295;

export type StakingPool = {
  id: number;
  name: string;
  stakedTokenId: number;
  stakedSym: string;
  rewardTokenId: number;
  rewardSym: string;
  apr: number;
  totalStaked: number;
  myStake: number;
  myEarned: number;
  lockMs: number;
  lockEndMs: number;
  unlocked: boolean;
  chain: number;
  vested: boolean;
  vestedCap: number;
};

export type StakeResult = { ok: boolean; myStake: number; myEarned: number };
export type HarvestResult = { amount: number; myStake: number; myEarned: number };

export type TapeEntry = {
  seq: number;
  id: number;
  sym: string;
  kind: 'buy' | 'sell';
  base: number;
  usd: number;
  price: number;
  impact: number;
  t: number;
  walletId: number;
};

export type NpcProfile =
  | 'retail' | 'swing' | 'whale' | 'alpha' | 'dev_insider'
  | 'mev_bot' | 'rug_runner' | 'paper_hands' | 'cartel';
const NPC_PROFILE_NAMES: NpcProfile[] = [
  'retail', 'swing', 'whale', 'alpha', 'dev_insider',
  'mev_bot', 'rug_runner', 'paper_hands', 'cartel',
];

export type Npc = {
  id: number;
  address: string;
  profile: NpcProfile;
  usdBalance: number;
  startingUsd: number;
  realizedPnl: number;
  tradeCount: number;
  holdingCount: number;
  repScore: number;
};

export type HardwareSlotName =
  'monitor' | 'cpu' | 'ram' | 'network' | 'sound' | 'gpu' | 'keyboard' | 'webcam';
const HARDWARE_SLOTS: HardwareSlotName[] = [
  'monitor', 'cpu', 'ram', 'network', 'sound', 'gpu', 'keyboard', 'webcam',
];

export type VenueName =
  'ad_slot' | 'token_site_feature' | 'forum_thread' | 'social_post'
  | 'social_dm' | 'cex_promo' | 'explorer_widget' | 'telegram_channel';
const VENUE_NAMES: VenueName[] = [
  'ad_slot', 'token_site_feature', 'forum_thread', 'social_post',
  'social_dm', 'cex_promo', 'explorer_widget', 'telegram_channel',
];

const _upgradeKindNames = new Map<number, string>();

export type Upgrade = {
  id: number;
  kind: number;
  kindName: string;
  tier: number;
  priceTokenId: number;
  priceAmount: number;
  legit: boolean;
  venue: VenueName;
  venueRef: number;
  expiresRealMs: number;
  purchased: boolean;
  vested: boolean;
  hwSlot: number;
};

export type OwnedHardware = Record<HardwareSlotName, number>;
export type BuyUpgradeResult = { ok: boolean; monitorTier: number };

export type MiningRig = {
  id: number;
  tier: number;
  targetTokenId: number;
  ratePerSec: number;
  powerCostPerHr: number;
  totalMined: number;
  wear: number;
  installedRealMs: number;
};

export type TeamKindName = 'anon' | 'partial' | 'doxxed' | 'celebrity' | 'dev_insider';
const TEAM_KIND_NAMES: TeamKindName[] = ['anon', 'partial', 'doxxed', 'celebrity', 'dev_insider'];

export type WhitepaperKindName = 'none' | 'plagiarized' | 'gibberish' | 'real';
const WHITEPAPER_NAMES: WhitepaperKindName[] = ['none', 'plagiarized', 'gibberish', 'real'];

export type AdPlacementName = 'top_banner' | 'sidebar' | 'in_feed' | 'interstitial';
const AD_PLACEMENT_NAMES: AdPlacementName[] = ['top_banner', 'sidebar', 'in_feed', 'interstitial'];

export type TokenSite = {
  tokenId: number;
  productionValue: number;
  scamFactor: number;
  clonedFrom: number;
  flair: number;
  mascotSeed: number;
  roadmapSeed: number;
  heroSeed: number;
  teamKind: TeamKindName;
  hasHoneypot: boolean;
  hasFakeStaking: boolean;
  whitepaperKind: WhitepaperKindName;
};

export type AdSlot = {
  id: number;
  placement: AdPlacementName;
  advertiserTokenId: number;
  leaseEndsRealMs: number;
  isScam: boolean;
};

export type CexInfo = {
  id: number;
  kycLevel: number;
  fee: number;
  listedCount: number;
};

export type CexBalanceInfo = {
  cexId: number;
  usdBalance: number;
  holdingCount: number;
};

export type PostKindName =
  'meme' | 'chart' | 'whale_watch' | 'alpha' | 'fake_alpha'
  | 'news' | 'rug_call' | 'scam_thread' | 'project_shill' | 'reply';
const POST_KIND_NAMES: PostKindName[] = [
  'meme', 'chart', 'whale_watch', 'alpha', 'fake_alpha',
  'news', 'rug_call', 'scam_thread', 'project_shill', 'reply',
];

export type SocialPost = {
  seq: number;
  realMs: number;
  authorWalletId: number;
  kind: PostKindName;
  relatedTokenId: number;
  templateId: number;
  textSeed: number;
  likes: number;
  retweets: number;
};

export type TGChannelKindName = 'broadcast' | 'group' | 'pump_group' | 'otc' | 'dm' | 'private';
const TG_CHANNEL_KIND_NAMES: TGChannelKindName[] = ['broadcast', 'group', 'pump_group', 'otc', 'dm', 'private'];

export type TGChannel = {
  id: number;
  handle: string;
  title: string;
  kind: TGChannelKindName;
  adminWalletId: number;
  memberCount: number;
  subscribed: boolean;
  signalQuality: number;
  inviteOnly: boolean;
};

export type ForumBoardInfo = {
  forumId: number;
  boardIdx: number;
  name: string;
  description: string;
  threadCount: number;
};

export type NewsKindName =
  'pump_recap' | 'rug_report' | 'hack' | 'listing_announcement'
  | 'regulatory_fud' | 'regulatory_good' | 'partnership' | 'scam_warning';
const NEWS_KIND_NAMES: NewsKindName[] = [
  'pump_recap', 'rug_report', 'hack', 'listing_announcement',
  'regulatory_fud', 'regulatory_good', 'partnership', 'scam_warning',
];

export type NewsArticle = {
  id: number;
  realMs: number;
  kind: NewsKindName;
  relatedTokenId: number;
  headlineSeed: number;
  bodySeed: number;
};

export type AlphaLeak = {
  seq: number;
  npcId: number;
  tokenId: number;
  realMsLeaked: number;
  realMsFires: number;
  correct: boolean;
  isFake: boolean;
};

export type LpPosition = {
  id: number;
  tokenId: number;
  baseDeposited: number;
  quoteDeposited: number;
  lpShare: number;
  feesEarned: number;
  openedRealMs: number;
};

export type PumpFavor = {
  id: number;
  grantedByWalletId: number;
  targetTokenId: number;
  startRealMs: number;
  dumpRealMs: number;
  pumpPct: number;
  repCost: number;
  backstab: boolean;
  firedPump: boolean;
  firedDump: boolean;
};

export type RepEntry = {
  walletId: number;
  score: number;
  interactions: number;
};

// ── String metadata caches (populated from one-shot zig emits) ─────────

const _symbols = new Map<number, string>();
const _npcMeta = new Map<number, { address: string; profile: NpcProfile }>();
const _stakingMeta = new Map<number, { name: string; stakedSym: string; rewardSym: string }>();
const _tgChannelMeta = new Map<number, { handle: string; title: string }>();
const _forumBoardMeta = new Map<number, { name: string; description: string }>();
const _npcs = new Map<number, Npc>();

let _playerAddress: string | null = null;
let _enginePending = { tokens: false, npcs: false };

function trySeedEngine(): void {
  if (!_enginePending.tokens || !_enginePending.npcs) return;
  const r = zigCall('snapshot_run_id') as { run_id_hi: number; run_id_lo: number } | null;
  const hi = r ? BigInt(r.run_id_hi >>> 0) : 0n;
  const lo = r ? BigInt(r.run_id_lo >>> 0) : 0n;
  const runId = (hi << 32n) | lo;
  const tokens = Array.from(_symbols.entries()).map(([id, sym]) => ({ id, sym })).sort((a, b) => a.id - b.id);
  const npcs = Array.from(_npcMeta.entries()).map(([id, m]) => ({ id, profile: m.profile }));
  engine.seed({ runId, tokens, npcs });
  // Cold-system meta needs to be re-pulled now that engine has rolled.
  _stakingMeta.clear();
  for (const p of engine.stakingMeta()) _stakingMeta.set(p.id, { name: p.name, stakedSym: p.stakedSym, rewardSym: p.rewardSym });
  _tgChannelMeta.clear();
  for (const c of engine.tgChannelMeta()) _tgChannelMeta.set(c.id, { handle: c.handle, title: c.title });
  _forumBoardMeta.clear();
  for (const b of engine.forumBoardMeta()) _forumBoardMeta.set(b.boardIdx, { name: b.name, description: b.description });
  _upgradeKindNames.clear();
  for (const k of engine.upgradeKindNames()) _upgradeKindNames.set(k.value, k.name);
  notify(_stakingListeners);
  notify(_upgradeListeners);
}

subscribe('sim:tokens', (raw: any) => {
  let arr: { id: number; sym: string }[];
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
  if (!Array.isArray(arr)) return;
  _symbols.clear();
  for (const t of arr) _symbols.set(t.id, t.sym);
  _enginePending.tokens = true;
  trySeedEngine();
  notify(_listeners);
});

subscribe('sim:player', (raw: any) => {
  let payload: { address: string };
  try { payload = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
  if (!payload?.address) return;
  _playerAddress = payload.address;
  notify(_playerListeners);
});

subscribe('sim:npcs:init', (raw: any) => {
  let arr: { id: number; address: string; profile: NpcProfile }[];
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
  if (!Array.isArray(arr)) return;
  _npcMeta.clear();
  for (const n of arr) _npcMeta.set(n.id, { address: n.address, profile: n.profile });
  _enginePending.npcs = true;
  trySeedEngine();
  notify(_npcListeners);
});

subscribe('sim:trade:reset', () => {
  _trades.length = 0;
  _tape.length = 0;
  _latest.clear();
  _history.clear();
  _next_seq = 1;
  engine.invalidate();
  _enginePending = { tokens: false, npcs: false };
  notify(_tradeListeners);
  notify(_listeners);
});

// ── Public sim API ─────────────────────────────────────────────────────

export const sim = {
  currentPrice: (id: number) => (zigCall('current_price', id) as number) ?? 0,
  tokenCount:   ()           => (zigCall('token_count')      as number) ?? 0,
  tickCount:    ()           => (zigCall('tick_count')       as number) ?? 0,
  realTimeMs:   ()           => (zigCall('real_time_ms')     as number) ?? 0,
  quoteBuy:     (id: number, usd: number)  => zigCall('quote_buy', id, usd) as QuoteResult,
  quoteSell:    (id: number, amt: number)  => zigCall('quote_sell', id, amt) as QuoteResult,
  buy: (id: number, usd: number): TradeResult => {
    const r = zigCall('buy', id, usd) as { ok: number; output: number; impact: number; fee: number; effective_price: number } | null;
    if (!r) return { ok: false, output: 0, impact: 0, fee: 0, effective_price: 0 };
    const ok = r.ok !== 0;
    if (ok) pushTrade('buy', id, r.output, usd, r.effective_price, r.fee, r.impact);
    return { ok, output: r.output, impact: r.impact, fee: r.fee, effective_price: r.effective_price };
  },
  sell: (id: number, amt: number): TradeResult => {
    const r = zigCall('sell', id, amt) as { ok: number; output: number; impact: number; fee: number; effective_price: number } | null;
    if (!r) return { ok: false, output: 0, impact: 0, fee: 0, effective_price: 0 };
    const ok = r.ok !== 0;
    if (ok) pushTrade('sell', id, amt, r.output, r.effective_price, r.fee, r.impact);
    return { ok, output: r.output, impact: r.impact, fee: r.fee, effective_price: r.effective_price };
  },
  reset: () => zigCall('reset'),
  addRandomToken: () => (zigCall('add_random_token') as number) ?? 0,
  stake: (poolId: number, amount: number): StakeResult => {
    const r = engine.stake(poolId, amount, _engineRealMs());
    return { ok: r.ok !== 0, myStake: r.my_stake, myEarned: r.my_earned };
  },
  unstake: (poolId: number, amount: number): StakeResult => {
    const r = engine.unstake(poolId, amount, _engineRealMs());
    return { ok: r.ok !== 0, myStake: r.my_stake, myEarned: r.my_earned };
  },
  harvest: (poolId: number): HarvestResult => {
    const r = engine.harvest(poolId);
    return { amount: r.amount, myStake: r.my_stake, myEarned: r.my_earned };
  },
  npcCount: () => (zigCall('npc_count') as number) ?? 0,
  runId: (): string => {
    const r = zigCall('snapshot_run_id') as { run_id_hi: number; run_id_lo: number } | null;
    if (!r) return '0x0';
    const hi = (r.run_id_hi | 0).toString(16).padStart(8, '0');
    const lo = (r.run_id_lo | 0).toString(16).padStart(8, '0');
    return '0x' + hi + lo;
  },
  setRunId: (hex: string | null): void => {
    if (!hex || hex === 'fresh') { zigCall('set_run_id', 0, 0); return; }
    const h = hex.replace(/^0x/i, '').padStart(16, '0').slice(-16);
    const hi = parseInt(h.slice(0, 8), 16) || 0;
    const lo = parseInt(h.slice(8, 16), 16) || 0;
    zigCall('set_run_id', hi, lo);
  },
  npcRange: (start: number, count: number): Npc[] => {
    const rows = zigCall('snapshot_npcs', start, count) as Array<{ id: number; profile: number; usd_balance: number; starting_usd: number; realized_pnl: number; trade_count: number; holding_count: number; rep_score: number }> | null;
    if (!rows || !Array.isArray(rows)) return [];
    const out: Npc[] = [];
    for (const r of rows) {
      const meta = _npcMeta.get(r.id);
      const entry: Npc = {
        id: r.id,
        address: meta?.address ?? '0x?',
        profile: meta?.profile ?? (NPC_PROFILE_NAMES[r.profile] ?? 'retail'),
        usdBalance: r.usd_balance,
        startingUsd: r.starting_usd,
        realizedPnl: r.realized_pnl,
        tradeCount: r.trade_count,
        holdingCount: r.holding_count,
        repScore: r.rep_score,
      };
      out.push(entry);
      _npcs.set(r.id, entry);
    }
    return out;
  },
  npcMeta: (walletId: number): { address: string; profile: NpcProfile } | undefined => {
    if (walletId <= 0) return undefined;
    return _npcMeta.get(walletId);
  },

  upgrades: (): Upgrade[] => engine.snapshot_upgrades().map((r) => ({
    id: r.id, kind: r.kind,
    kindName: _upgradeKindNames.get(r.kind) ?? `kind:${r.kind}`,
    tier: r.tier,
    priceTokenId: r.price_token_id, priceAmount: r.price_amount,
    legit: r.legit !== 0,
    venue: VENUE_NAMES[r.venue] ?? 'ad_slot',
    venueRef: r.venue_ref,
    expiresRealMs: r.expires_real_ms,
    purchased: r.purchased !== 0, vested: r.vested !== 0, hwSlot: r.hw_slot,
  })),
  hardware: (): OwnedHardware => engine.snapshot_hardware() as OwnedHardware,
  buyUpgrade: (id: number): BuyUpgradeResult => {
    const r = engine.buy_upgrade(id);
    return { ok: r.ok !== 0, monitorTier: r.monitor_tier };
  },
  setHardwareTier: (slot: HardwareSlotName | number, tier: number): boolean => {
    const idx = typeof slot === 'number' ? slot : HARDWARE_SLOTS.indexOf(slot);
    if (idx < 0) return false;
    return engine.set_hardware_tier(idx, tier) === 1;
  },

  miningRigs: (): MiningRig[] => engine.snapshot_mining().map((r) => ({
    id: r.id, tier: r.tier,
    targetTokenId: r.target_token_id,
    ratePerSec: r.rate_per_sec,
    powerCostPerHr: r.power_cost_per_hr,
    totalMined: r.total_mined, wear: r.wear,
    installedRealMs: r.installed_real_ms,
  })),
  installMiningRig: (tier: number, tokenId: number): number => engine.install_mining_rig(tier, tokenId, _engineRealMs()),
  repointMiningRig: (rigIdx: number, tokenId: number): boolean => engine.repoint_mining_rig(rigIdx, tokenId) === 1,

  tokenSites: (): TokenSite[] => engine.snapshot_token_sites().map((r) => ({
    tokenId: r.token_id,
    productionValue: r.production_value, scamFactor: r.scam_factor,
    clonedFrom: r.cloned_from, flair: r.flair,
    mascotSeed: r.mascot_seed, roadmapSeed: r.roadmap_seed, heroSeed: r.hero_seed,
    teamKind: TEAM_KIND_NAMES[r.team_kind] ?? 'anon',
    hasHoneypot: r.has_honeypot !== 0, hasFakeStaking: r.has_fake_staking !== 0,
    whitepaperKind: WHITEPAPER_NAMES[r.whitepaper_kind] ?? 'none',
  })),
  adSlots: (): AdSlot[] => engine.snapshot_ad_slots().map((r) => ({
    id: r.id,
    placement: AD_PLACEMENT_NAMES[r.placement] ?? 'top_banner',
    advertiserTokenId: r.advertiser_token_id,
    leaseEndsRealMs: r.lease_ends_real_ms,
    isScam: r.is_scam !== 0,
  })),

  cexes: (): CexInfo[] => engine.snapshot_cexes().map((r) => ({
    id: r.id, kycLevel: r.kyc_level, fee: r.fee, listedCount: r.listed_count,
  })),
  cexBalance: (cexId: number): CexBalanceInfo => {
    const r = engine.snapshot_cex_balance(cexId);
    return { cexId: r.cex_id, usdBalance: r.usd_balance, holdingCount: r.holding_count };
  },
  cexDeposit: (cexId: number, tokenId: number, amount: number): boolean => engine.cex_deposit(cexId, tokenId, amount).ok !== 0,
  cexWithdraw: (cexId: number, tokenId: number, amount: number): boolean => engine.cex_withdraw(cexId, tokenId, amount).ok !== 0,
  cexBuy: (cexId: number, tokenId: number, usd: number): boolean => engine.cex_buy(cexId, tokenId, usd).ok !== 0,
  cexSell: (cexId: number, tokenId: number, amount: number): boolean => engine.cex_sell(cexId, tokenId, amount).ok !== 0,

  socialFeed: (max: number = 64): SocialPost[] => engine.snapshot_social(max).map((r) => ({
    seq: r.seq, realMs: r.real_ms,
    authorWalletId: r.author_wallet_id,
    kind: POST_KIND_NAMES[r.kind] ?? 'meme',
    relatedTokenId: r.related_token_id,
    templateId: r.template_id, textSeed: r.text_seed,
    likes: r.likes, retweets: r.retweets,
  })),
  tgChannels: (): TGChannel[] => engine.snapshot_tg_channels().map((r) => {
    const meta = _tgChannelMeta.get(r.id);
    return {
      id: r.id,
      handle: meta?.handle ?? `chan:${r.id}`,
      title: meta?.title ?? '',
      kind: TG_CHANNEL_KIND_NAMES[r.kind] ?? 'broadcast',
      adminWalletId: r.admin_wallet_id,
      memberCount: r.member_count,
      subscribed: r.subscribed !== 0,
      signalQuality: r.signal_quality,
      inviteOnly: r.invite_only !== 0,
    };
  }),
  forumBoards: (): ForumBoardInfo[] => engine.snapshot_forum_boards().map((r) => {
    const meta = _forumBoardMeta.get(r.board_idx);
    return {
      forumId: r.forum_id, boardIdx: r.board_idx,
      name: meta?.name ?? '', description: meta?.description ?? '',
      threadCount: r.thread_count,
    };
  }),
  newsFeed: (max: number = 32): NewsArticle[] => engine.snapshot_news(max).map((r) => ({
    id: r.id, realMs: r.real_ms,
    kind: NEWS_KIND_NAMES[r.kind] ?? 'pump_recap',
    relatedTokenId: r.related_token_id,
    headlineSeed: r.headline_seed, bodySeed: r.body_seed,
  })),
  alphaLeaks: (max: number = 16): AlphaLeak[] => engine.snapshot_alpha(max).map((r) => ({
    seq: r.seq, npcId: r.npc_id, tokenId: r.token_id,
    realMsLeaked: r.real_ms_leaked, realMsFires: r.real_ms_fires,
    correct: r.correct !== 0, isFake: r.is_fake !== 0,
  })),

  lpPositions: (): LpPosition[] => engine.snapshot_lp().map((r) => ({
    id: r.id, tokenId: r.token_id,
    baseDeposited: r.base_deposited, quoteDeposited: r.quote_deposited,
    lpShare: r.lp_share, feesEarned: r.fees_earned,
    openedRealMs: r.opened_real_ms,
  })),
  addLp: (tokenId: number, usd: number): { ok: boolean; id: number } => {
    const r = engine.add_lp(tokenId, usd, _engineRealMs());
    return { ok: r.ok !== 0, id: r.id };
  },
  removeLp: (positionIdx: number): { ok: boolean; usdReceived: number } => {
    const r = engine.remove_lp(positionIdx);
    return { ok: r.ok !== 0, usdReceived: r.usd_received };
  },

  favors: (): PumpFavor[] => engine.snapshot_favors().map((r) => ({
    id: r.id,
    grantedByWalletId: r.granted_by_wallet_id,
    targetTokenId: r.target_token_id,
    startRealMs: r.start_real_ms, dumpRealMs: r.dump_real_ms,
    pumpPct: r.pump_pct, repCost: r.rep_cost,
    backstab: r.backstab !== 0,
    firedPump: r.fired_pump !== 0,
    firedDump: r.fired_dump !== 0,
  })),
  consumeFavor: (tokenId: number, granterWalletId: number = 0): number =>
    engine.consume_favor(tokenId, granterWalletId, _engineRealMs()),

  reputation: (): RepEntry[] => engine.snapshot_rep().map((r) => ({
    walletId: r.wallet_id, score: r.score, interactions: r.interactions,
  })),
  repScore: (walletId: number): number => engine.rep_score(walletId),
  repAdjust: (walletId: number, delta: number): boolean => engine.rep_adjust(walletId, delta) === 1,
};

// ── Caches + listeners ─────────────────────────────────────────────────

const HISTORY_LEN = 200;
const TRADES_CAP = 256;
const TAPE_CAP = 400;
const PRICE_PULL_EVERY_FRAMES = 6;
const SNAPSHOT_PULL_EVERY_FRAMES = 30;
const COLD_TICK_EVERY_FRAMES = 30; // ~1Hz at 30Hz notify

const _history: Map<number, PriceSample[]> = new Map();
const _latest: Map<number, PriceSample> = new Map();
let _market: Market | null = null;
let _wallet: Wallet | null = null;
let _gameTime: GameTime | null = null;
const _trades: Trade[] = [];
const _tape: TapeEntry[] = [];

const _listeners = new Set<() => void>();
const _tokenListeners = new Map<number, Set<() => void>>();
const _marketListeners = new Set<() => void>();
const _walletListeners = new Set<() => void>();
const _tradeListeners = new Set<() => void>();
const _stakingListeners = new Set<() => void>();
const _npcListeners = new Set<() => void>();
const _upgradeListeners = new Set<() => void>();
const _playerListeners = new Set<() => void>();

const _stakingPools = new Map<number, StakingPool>();

function notify(s: Set<() => void>) {
  for (const fn of Array.from(s)) { try { fn(); } catch { /* ignore */ } }
}

function notifyToken(id: number) {
  const set = _tokenListeners.get(id);
  if (set) notify(set);
}

function getTokenListenerSet(id: number): Set<() => void> {
  let s = _tokenListeners.get(id);
  if (!s) { s = new Set(); _tokenListeners.set(id, s); }
  return s;
}

let _tradeSeq = 0;
function pushTrade(kind: 'buy'|'sell', id: number, base: number, usd: number, price: number, fee: number, impact: number): void {
  _tradeSeq += 1;
  const sym = _symbols.get(id) ?? '';
  const t = (zigCall('tick_count') as number) ?? 0;
  const realMs = (zigCall('real_time_ms') as number) ?? 0;
  const trade: Trade = { seq: _tradeSeq, kind, id, sym, base, usd, price, fee, impact, t, realMs };
  _trades.unshift(trade);
  if (_trades.length > TRADES_CAP) _trades.length = TRADES_CAP;
  notify(_tradeListeners);
  emit('sim:trade', trade);
}

let _engineRealMsCache = 0;
function _engineRealMs(): number { return _engineRealMsCache }

// ── Frame loop: drain hot ring + cold tick ──────────────────────────────

let _frame_n = 0;
let _loop_started = false;
let _last_cold_tick_ms = 0;

function startLoop() {
  if (_loop_started) return;
  _loop_started = true;
  const host = globalThis as any;
  const raf: (cb: () => void) => any = typeof host.requestAnimationFrame === 'function'
    ? host.requestAnimationFrame.bind(host)
    : (cb: () => void) => setTimeout(cb, 8);
  _last_cold_tick_ms = nowMs();
  const step = () => {
    drainFrame();
    raf(step);
  };
  raf(step);
}

const NOTIFY_HZ = 30;
const NOTIFY_MIN_GAP_MS = 1000 / NOTIFY_HZ;
let _last_notify_ms = 0;
let _pending_tape = false;
let _pending_market = false;
let _pending_wallet = false;
let _pending_staking = false;
let _next_seq = 1;

function nowMs(): number {
  const host = globalThis as any;
  if (typeof host.performance?.now === 'function') return host.performance.now();
  return Date.now();
}

const _dirty_tokens = new Set<number>();

function drainFrame() {
  _frame_n++;

  const tape = zigCall('drain_tape', 64) as Array<{ id: number; kind: number; pat: number; base: number; usd: number; price: number; impact: number; wallet_id: number }> | null;
  let tape_changed = false;
  if (tape && tape.length > 0) {
    for (let i = tape.length - 1; i >= 0; i--) {
      const r = tape[i];
      const sym = _symbols.get(r.id) ?? '';
      const kind: 'buy'|'sell' = r.kind === 0 ? 'buy' : 'sell';
      const entry: TapeEntry = {
        seq: _next_seq++,
        id: r.id, sym, kind,
        base: r.base, usd: r.usd, price: r.price, impact: r.impact,
        t: r.id, walletId: r.wallet_id ?? 0,
      };
      _tape.unshift(entry);
      const ts = (_frame_n << 8) | (i & 0xff);
      const prev = _latest.get(r.id);
      const next: PriceSample = {
        id: r.id, sym, p: r.price, t: ts,
        pat: PATTERN_NAMES[r.pat] ?? 'crab',
        rug: r.kind === 2 || (prev?.rug ?? false),
        ath: prev ? Math.max(prev.ath, r.price) : r.price,
        atl: prev ? Math.min(prev.atl, r.price) : r.price,
        marketCapUsd: prev?.marketCapUsd ?? 0,
        volumeUsd: prev?.volumeUsd ?? 0,
        liquidityUsd: prev?.liquidityUsd ?? 0,
      };
      _latest.set(r.id, next);
      let h = _history.get(r.id);
      if (!h) { h = []; _history.set(r.id, h); }
      h.push(next);
      if (h.length > HISTORY_LEN) h.shift();
      _dirty_tokens.add(r.id);
      // Whale-watch: fire a social post for sizable NPC trades.
      if (r.usd > 5_000 && r.wallet_id && r.wallet_id !== 0) {
        engine.pushWhaleWatch(_engineRealMsCache, r.wallet_id, r.id, r.usd, r.kind === 0);
      }
    }
    if (_tape.length > TAPE_CAP) _tape.length = TAPE_CAP;
    tape_changed = true;
  }

  let prices_changed = false;
  if ((_frame_n % PRICE_PULL_EVERY_FRAMES) === 0) {
    const rows = zigCall('snapshot_prices') as Array<{ id: number; price: number; pat: number; rug: number; ath: number; atl: number; market_cap_usd: number; volume_usd: number; liquidity_usd: number }> | null;
    if (rows && Array.isArray(rows)) {
      for (const r of rows) {
        const sym = _symbols.get(r.id) ?? '';
        const prev = _latest.get(r.id);
        const next: PriceSample = {
          id: r.id, sym, p: r.price, t: prev?.t ?? 0,
          pat: PATTERN_NAMES[r.pat] ?? 'crab',
          rug: r.rug !== 0,
          ath: r.ath, atl: r.atl,
          marketCapUsd: r.market_cap_usd,
          volumeUsd: r.volume_usd,
          liquidityUsd: r.liquidity_usd,
        };
        if (!prev
          || prev.p !== next.p || prev.rug !== next.rug || prev.pat !== next.pat
          || prev.marketCapUsd !== next.marketCapUsd || prev.volumeUsd !== next.volumeUsd) {
          _latest.set(r.id, next);
          prices_changed = true;
          _dirty_tokens.add(r.id);
        }
      }
    }
  }

  let market_changed = false;
  let wallet_changed = false;
  let staking_changed = false;
  if ((_frame_n % SNAPSHOT_PULL_EVERY_FRAMES) === 0) {
    const m = zigCall('snapshot_market') as { trend: number; vol: number; fg: number; trend_age: number } | null;
    if (m) {
      const next: Market = { trend: TREND_NAMES[m.trend] ?? 'crab', vol: m.vol, fg: m.fg, trendAge: m.trend_age };
      if (!_market || _market.trend !== next.trend || _market.vol !== next.vol || _market.fg !== next.fg) {
        _market = next; market_changed = true;
      }
    }
    const tr = zigCall('snapshot_time') as { real_ms: number; day: number; hour: number; day_ms: number } | null;
    if (tr) {
      _engineRealMsCache = tr.real_ms;
      const tnext: GameTime = { realMs: tr.real_ms, day: tr.day, hour: tr.hour, dayMs: tr.day_ms };
      if (!_gameTime || _gameTime.day !== tnext.day || _gameTime.hour !== tnext.hour) {
        _gameTime = tnext; market_changed = true;
      }
    }
    const ws = zigCall('snapshot_wallet') as { usd: number; total_usd: number; start_usd: number; trades: number } | null;
    if (ws) {
      const holdingsRows = (zigCall('snapshot_holdings') as Array<{ id: number; amount: number; avg: number; invested: number; upnl: number; rpnl: number }> | null) ?? [];
      const holdings: Holding[] = holdingsRows.map((h) => ({
        id: h.id, sym: _symbols.get(h.id) ?? '',
        amt: h.amount, avg: h.avg, inv: h.invested,
        upnl: h.upnl, rpnl: h.rpnl,
      }));
      const wnext: Wallet = { usd: ws.usd, totalUsd: ws.total_usd, start: ws.start_usd, trades: ws.trades, holdings };
      if (!_wallet || _wallet.usd !== wnext.usd || _wallet.totalUsd !== wnext.totalUsd
        || _wallet.trades !== wnext.trades || _wallet.holdings.length !== holdings.length) {
        _wallet = wnext; wallet_changed = true;
      }
    }
    // Staking snapshot pulled from the engine (cold-side state).
    const sk = engine.snapshot_staking(_engineRealMsCache);
    for (const r of sk) {
      const meta = _stakingMeta.get(r.id);
      const prev = _stakingPools.get(r.id);
      const next: StakingPool = {
        id: r.id,
        name: meta?.name ?? `Pool ${r.id}`,
        stakedTokenId: r.staked_token_id,
        stakedSym: meta?.stakedSym ?? '',
        rewardTokenId: r.reward_token_id,
        rewardSym: meta?.rewardSym ?? '',
        apr: r.apr,
        totalStaked: r.total_staked,
        myStake: r.my_stake,
        myEarned: r.my_earned,
        lockMs: r.lock_ms,
        lockEndMs: r.lock_end_ms,
        unlocked: r.unlocked !== 0,
        chain: r.chain,
        vested: r.vested !== 0,
        vestedCap: r.vested_cap,
      };
      if (!prev
        || prev.myStake !== next.myStake
        || prev.myEarned !== next.myEarned
        || prev.totalStaked !== next.totalStaked
        || prev.unlocked !== next.unlocked) {
        _stakingPools.set(r.id, next);
        staking_changed = true;
      }
    }
  }

  // Cold tick: drive the engine's mining/lp/favor/staking-accrual once
  // per ~30 frames (≈1Hz at 30Hz notify). Keep it cheap regardless of
  // frame rate — there's no benefit to ticking it faster than ~10Hz.
  if ((_frame_n % COLD_TICK_EVERY_FRAMES) === 0) {
    const t = nowMs();
    const dt = Math.min(Math.max(t - _last_cold_tick_ms, 0), 5_000);
    _last_cold_tick_ms = t;
    engine.tickCold(dt, _engineRealMsCache);
  }

  if (tape_changed || prices_changed) _pending_tape = true;
  if (market_changed) _pending_market = true;
  if (wallet_changed) _pending_wallet = true;
  if (staking_changed) _pending_staking = true;

  const t = nowMs();
  if (t - _last_notify_ms >= NOTIFY_MIN_GAP_MS) {
    _last_notify_ms = t;
    if (_pending_tape) {
      _pending_tape = false;
      notify(_listeners);
      for (const id of _dirty_tokens) notifyToken(id);
      _dirty_tokens.clear();
    }
    if (_pending_market) { _pending_market = false; notify(_marketListeners); }
    if (_pending_wallet) { _pending_wallet = false; notify(_walletListeners); }
    if (_pending_staking) { _pending_staking = false; notify(_stakingListeners); }
  }
}

function ensureLoop() { if (!_loop_started) startLoop() }

// ── Hooks (unchanged surface) ──────────────────────────────────────────

function useSub(listeners: Set<() => void>): void {
  ensureLoop();
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => (n + 1) & 0xffff);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, [listeners]);
}

export function usePriceHistory(tokenId: number): PriceSample[] {
  useSub(getTokenListenerSet(tokenId));
  return _history.get(tokenId) ?? [];
}
export function useLatestPrice(tokenId: number): PriceSample | undefined {
  useSub(getTokenListenerSet(tokenId));
  return _latest.get(tokenId);
}
export function useAllLatest(): PriceSample[] {
  useSub(_listeners);
  return Array.from(_latest.values()).sort((a, b) => a.id - b.id);
}
export function useMarket(): Market | null { useSub(_marketListeners); return _market; }
export function useWallet(): Wallet | null { useSub(_walletListeners); return _wallet; }
export function useTrades(): Trade[] { useSub(_tradeListeners); return _trades; }
export function usePlayerAddress(): string | null { useSub(_playerListeners); return _playerAddress; }
export function useGameTime(): GameTime | null { useSub(_marketListeners); return _gameTime; }
export function useTape(tokenId?: number): TapeEntry[] {
  useSub(_listeners);
  if (tokenId == null) return _tape;
  return _tape.filter((e) => e.id === tokenId);
}

export function useAllStakingPools(): StakingPool[] {
  useSub(_stakingListeners);
  return Array.from(_stakingPools.values()).sort((a, b) => a.id - b.id);
}

export function useStakingPool(poolId: number): StakingPool | undefined {
  useSub(_stakingListeners);
  return _stakingPools.get(poolId);
}

export function useNpcRange(start: number, count: number): Npc[] {
  useSub(_npcListeners);
  return sim.npcRange(start, count);
}

export function useNpcById(walletId: number): { address: string; profile: NpcProfile } | undefined {
  useSub(_npcListeners);
  if (walletId <= 0) return undefined;
  return _npcMeta.get(walletId);
}

export function useUpgrades(): Upgrade[] {
  useSub(_upgradeListeners);
  return sim.upgrades();
}

export function useHardwareTier(slot: HardwareSlotName): number {
  useSub(_upgradeListeners);
  return sim.hardware()[slot];
}

export function useOwnedHardware(): OwnedHardware {
  useSub(_upgradeListeners);
  return sim.hardware();
}

export function useMiningRigs(): MiningRig[] {
  useSub(_upgradeListeners);
  return sim.miningRigs();
}

export function useTokenSites(): TokenSite[] {
  useSub(_listeners);
  return sim.tokenSites();
}

export function useTokenSite(tokenId: number): TokenSite | undefined {
  const all = useTokenSites();
  return all.find((s) => s.tokenId === tokenId);
}

export function useAdSlots(): AdSlot[] {
  useSub(_listeners);
  return sim.adSlots();
}

export function useCexes(): CexInfo[] {
  useSub(_listeners);
  return sim.cexes();
}

export function useCexBalance(cexId: number): CexBalanceInfo {
  useSub(_walletListeners);
  return sim.cexBalance(cexId);
}

export function useSocialFeed(max: number = 64): SocialPost[] {
  useSub(_listeners);
  return sim.socialFeed(max);
}

export function useTGChannels(): TGChannel[] {
  useSub(_listeners);
  return sim.tgChannels();
}

export function useForumBoards(): ForumBoardInfo[] {
  useSub(_listeners);
  return sim.forumBoards();
}

export function useNewsFeed(max: number = 32): NewsArticle[] {
  useSub(_listeners);
  return sim.newsFeed(max);
}

export function useAlphaLeaks(max: number = 16): AlphaLeak[] {
  useSub(_listeners);
  return sim.alphaLeaks(max);
}

export function useLpPositions(): LpPosition[] {
  useSub(_walletListeners);
  return sim.lpPositions();
}

export function useFavors(): PumpFavor[] {
  useSub(_walletListeners);
  return sim.favors();
}

export function useReputation(): RepEntry[] {
  useSub(_walletListeners);
  return sim.reputation();
}
