// sim_engine — TypeScript home for the cart's COLD content systems
// (staking, upgrades+hardware, mining rigs, LP positions, favors,
// web sites + ad slots, CEX, social ring, telegram, forums, news,
// alpha leaks, reputation). The HOT path (rng, market, price, pool,
// tape, wallet, base coins, NPC roster, reactive queue, heat, the
// per-tick Poisson scheduler) lives in framework/sim/*.zig.
//
// Cold systems are seeded once from the run_id + roster meta sim.ts
// pulls out of the zig sim, then ticked at the snapshot cadence
// (~10Hz) by sim.ts. State-mutating actions that touch wallet/pool
// state cross back into zig via `apply_*` zigcalls.

declare const globalThis: any;

function zigCall(fn: string, ...args: any[]): any {
  const host = globalThis as any;
  if (typeof host.__zig_call !== 'function') return null;
  return host.__zig_call('sim', fn, ...args);
}

// ─── RNG (deterministic per run_id) ─────────────────────────────────────

class Rng {
  private s0 = 0n; private s1 = 0n; private s2 = 0n; private s3 = 0n;
  constructor(seed: bigint) { this.seedWith(seed) }
  seedWith(seed: bigint): void {
    let z = seed & 0xFFFFFFFFFFFFFFFFn;
    const next = (): bigint => {
      z = (z + 0x9E3779B97F4A7C15n) & 0xFFFFFFFFFFFFFFFFn;
      let x = z;
      x = ((x ^ (x >> 30n)) * 0xBF58476D1CE4E5B9n) & 0xFFFFFFFFFFFFFFFFn;
      x = ((x ^ (x >> 27n)) * 0x94D049BB133111EBn) & 0xFFFFFFFFFFFFFFFFn;
      return (x ^ (x >> 31n)) & 0xFFFFFFFFFFFFFFFFn;
    };
    this.s0 = next(); this.s1 = next(); this.s2 = next(); this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0n) this.s0 = 1n;
  }
  private rotl(x: bigint, k: bigint): bigint { return (((x << k) | (x >> (64n - k))) & 0xFFFFFFFFFFFFFFFFn) }
  next64(): bigint {
    const result = (this.rotl((this.s1 * 5n) & 0xFFFFFFFFFFFFFFFFn, 7n) * 9n) & 0xFFFFFFFFFFFFFFFFn;
    const t = (this.s1 << 17n) & 0xFFFFFFFFFFFFFFFFn;
    this.s2 ^= this.s0; this.s3 ^= this.s1;
    this.s1 ^= this.s2; this.s0 ^= this.s3;
    this.s2 ^= t; this.s3 = this.rotl(this.s3, 45n);
    return result;
  }
  float(): number { return Number(this.next64() >> 11n) / Number(1n << 53n) }
  intRange(max: number): number { return max <= 0 ? 0 : Math.floor(this.float() * (max + 1)) }
  u32(): number { return Number(this.next64() & 0xFFFFFFFFn) >>> 0 }
}

// ─── Shared chain enum (matches basecoin.zig:Chain) ─────────────────────

type Chain = 0|1|2|3|4|5|6|7|8|9|10|11|12;

// ─── Staking ────────────────────────────────────────────────────────────

const ASSET_USDT = 0xFFFFFFFF;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const MAX_STAKING_POOLS = 64;

interface StakingPool {
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
  homeChain: Chain;
  vested: boolean;
  vestedCap: number;
}

const STAKING_RECIPES: Array<{ name: string; chain: Chain; stakedSym: string; rewardSym: string; apr: number; lockMs: number; vested?: boolean; vestedCap?: number }> = [
  { name: "USDT Saver",      chain: 1, stakedSym: "",     rewardSym: "USDT",  apr: 0.08, lockMs: 0 },
  { name: "Syrup Pool USDT", chain: 2, stakedSym: "",     rewardSym: "CAKE",  apr: 0.42, lockMs: 0 },
  { name: "Locked USDT 7d",  chain: 2, stakedSym: "",     rewardSym: "CAKE",  apr: 1.20, lockMs: 7 * 60_000, vested: true, vestedCap: 5_000 },
  { name: "DEGEN Farm",      chain: 2, stakedSym: "DEGEN",rewardSym: "CAKE",  apr: 3.50, lockMs: 0 },
  { name: "SHIT Solo",       chain: 1, stakedSym: "SHIT", rewardSym: "SHIT",  apr: 5.00, lockMs: 0, vested: true, vestedCap: 50_000 },
  { name: "MOON Kashi",      chain: 7, stakedSym: "MOON", rewardSym: "SUSHI", apr: 1.80, lockMs: 0, vested: true, vestedCap: 10_000 },
  { name: "WGMI Yield",      chain: 8, stakedSym: "WGMI", rewardSym: "USDT",  apr: 0.95, lockMs: 0 },
];

function seedStakingPools(symbolToId: Map<string, number>): StakingPool[] {
  const out: StakingPool[] = [];
  for (let idx = 0; idx < STAKING_RECIPES.length && idx < MAX_STAKING_POOLS; idx++) {
    const r = STAKING_RECIPES[idx];
    let stakedTokenId = ASSET_USDT;
    let stakedSym = 'USDT';
    if (r.stakedSym !== '') {
      const found = symbolToId.get(r.stakedSym);
      if (found !== undefined) { stakedTokenId = found; stakedSym = r.stakedSym; }
    }
    out.push({
      id: idx,
      name: r.name,
      stakedTokenId, stakedSym,
      rewardTokenId: ASSET_USDT,
      rewardSym: r.rewardSym,
      apr: r.apr,
      totalStaked: 25_000 + r.apr * 10_000,
      myStake: 0,
      myEarned: 0,
      lockMs: r.lockMs,
      lockEndMs: 0,
      homeChain: r.chain,
      vested: r.vested ?? false,
      vestedCap: r.vestedCap ?? 0,
    });
  }
  return out;
}

// ─── Upgrades + hardware ────────────────────────────────────────────────

const UPGRADE_POOL_SIZE = 64;
const HW_SLOT_COUNT = 8;

const UPGRADE_KIND_NAMES = [
  'rug_shield','holding_insurance','private_mempool','alpha_radar',
  'rugcheck_premium','whale_alerts','contract_audit_view','slippage_buffer',
  'deeper_pockets','one_click_swap','fast_withdrawal',
  'hw_monitor','hw_cpu','hw_ram','hw_network','hw_sound','hw_gpu','hw_keyboard','hw_webcam',
  'mining_rig','lp_position','validator_node','bridge_operator',
  'pump_favor','insider_tip','rugcheck_override','lawyer_call',
  'app_telegram','app_sniper_bot','app_arb_bot','app_honeypot_scanner',
  'app_wallet_tracker','app_calculator','app_notepad','app_mev_protector',
  'script_dca','script_stop_loss','script_trailing_stop','script_rebalance',
  'extra_staking_cap','starting_capital','second_wallet',
] as const;
type UpgradeKindName = typeof UPGRADE_KIND_NAMES[number];
const KIND_IDX: Record<UpgradeKindName, number> = Object.fromEntries(UPGRADE_KIND_NAMES.map((n, i) => [n, i])) as any;

const HW_SLOT_FOR_KIND: Partial<Record<UpgradeKindName, number>> = {
  hw_monitor: 0, hw_cpu: 1, hw_ram: 2, hw_network: 3, hw_sound: 4, hw_gpu: 5, hw_keyboard: 6, hw_webcam: 7,
};

const VENUE_NAMES = ['ad_slot','token_site_feature','forum_thread','social_post','social_dm','cex_promo','explorer_widget','telegram_channel'] as const;
type VenueName = typeof VENUE_NAMES[number];
const VENUE_IDX: Record<VenueName, number> = Object.fromEntries(VENUE_NAMES.map((n, i) => [n, i])) as any;

interface Upgrade {
  id: number; kind: number; tier: number;
  priceTokenId: number; priceAmount: number;
  legit: boolean; venue: number; venueRef: number;
  expiresRealMs: number; purchased: boolean; vested: boolean; hwSlot: number;
}

function isVestedByDefault(kindIdx: number): boolean {
  const name = UPGRADE_KIND_NAMES[kindIdx];
  if (HW_SLOT_FOR_KIND[name] !== undefined) return true;
  return name === 'extra_staking_cap' || name === 'starting_capital' || name === 'second_wallet';
}

const UPGRADE_RECIPES: Array<{ kind: UpgradeKindName; tier: number; usdPrice: number; venue: VenueName }> = [
  { kind: 'hw_monitor', tier: 1, usdPrice: 250.0,    venue: 'explorer_widget' },
  { kind: 'hw_monitor', tier: 2, usdPrice: 1_200.0,  venue: 'explorer_widget' },
  { kind: 'hw_monitor', tier: 3, usdPrice: 3_500.0,  venue: 'explorer_widget' },
  { kind: 'hw_cpu',     tier: 1, usdPrice: 600.0,    venue: 'explorer_widget' },
  { kind: 'hw_network', tier: 1, usdPrice: 400.0,    venue: 'cex_promo' },
  { kind: 'hw_ram',     tier: 1, usdPrice: 300.0,    venue: 'ad_slot' },
  { kind: 'rug_shield',          tier: 1, usdPrice: 500.0,   venue: 'forum_thread' },
  { kind: 'alpha_radar',         tier: 1, usdPrice: 2_000.0, venue: 'forum_thread' },
  { kind: 'slippage_buffer',     tier: 1, usdPrice: 800.0,   venue: 'ad_slot' },
  { kind: 'private_mempool',     tier: 1, usdPrice: 5_000.0, venue: 'social_dm' },
  { kind: 'app_telegram',        tier: 1, usdPrice: 0.0,     venue: 'ad_slot' },
  { kind: 'app_sniper_bot',      tier: 1, usdPrice: 1_500.0, venue: 'forum_thread' },
  { kind: 'app_arb_bot',         tier: 1, usdPrice: 2_500.0, venue: 'forum_thread' },
  { kind: 'app_honeypot_scanner',tier: 1, usdPrice: 800.0,   venue: 'ad_slot' },
  { kind: 'mining_rig',          tier: 1, usdPrice: 3_000.0, venue: 'ad_slot' },
  { kind: 'lp_position',         tier: 1, usdPrice: 0.0,     venue: 'explorer_widget' },
  { kind: 'starting_capital',    tier: 1, usdPrice: 5_000.0, venue: 'forum_thread' },
  { kind: 'extra_staking_cap',   tier: 1, usdPrice: 8_000.0, venue: 'forum_thread' },
];

function seedUpgradeMarket(runId: bigint): Upgrade[] {
  const rng = new Rng(runId ^ 0xFADEC0DE00000001n);
  const out: Upgrade[] = [];
  for (const r of UPGRADE_RECIPES) {
    if (out.length >= UPGRADE_POOL_SIZE) break;
    const kindIdx = KIND_IDX[r.kind];
    const hwSlot = HW_SLOT_FOR_KIND[r.kind];
    const isHardware = hwSlot !== undefined;
    let legit = true;
    if (!isHardware && rng.float() < 0.08) legit = false;
    out.push({
      id: out.length, kind: kindIdx, tier: r.tier,
      priceTokenId: ASSET_USDT, priceAmount: r.usdPrice,
      legit, venue: VENUE_IDX[r.venue], venueRef: 0,
      expiresRealMs: 0, purchased: false,
      vested: isVestedByDefault(kindIdx), hwSlot: hwSlot ?? 0,
    });
  }
  return out;
}

// ─── Mining ─────────────────────────────────────────────────────────────

const MINING_RIG_CAP = 8;
const TIER_RATE = [0, 0.02, 0.05, 0.12, 0.28, 0.60];
const TIER_POWER = [0, 0.18, 0.35, 0.70, 1.40, 2.80];

interface MiningRig {
  id: number; tier: number;
  targetTokenId: number;
  ratePerSec: number;
  powerCostPerHr: number;
  totalMined: number;
  wear: number;
  installedRealMs: number;
}

// ─── LP positions ───────────────────────────────────────────────────────

const LP_POSITION_CAP = 16;

interface LpPosition {
  id: number; tokenId: number;
  baseDeposited: number; quoteDeposited: number;
  lpShare: number; feesEarned: number;
  openedRealMs: number;
}

// ─── Favors ─────────────────────────────────────────────────────────────

const FAVOR_CAP = 16;

interface PumpFavor {
  id: number;
  grantedByWalletId: number;
  targetTokenId: number;
  startRealMs: number; dumpRealMs: number;
  pumpPct: number; repCost: number;
  backstab: boolean; firedPump: boolean; firedDump: boolean;
}

// ─── Reputation ─────────────────────────────────────────────────────────

const REP_CAP = 64;

interface RepEntry { walletId: number; score: number; interactions: number }

// ─── Web (token sites + ad slots) ───────────────────────────────────────

const WEB_AD_SLOTS = 8;

interface TokenSite {
  tokenId: number;
  productionValue: number; scamFactor: number;
  clonedFrom: number; flair: number;
  mascotSeed: number; roadmapSeed: number; heroSeed: number;
  teamKind: number;
  hasHoneypot: boolean; hasFakeStaking: boolean;
  whitepaperKind: number;
}

function rollTokenSite(tokenId: number, runId: bigint): TokenSite {
  const r = new Rng(runId ^ 0xFADE517600000000n ^ BigInt(tokenId));
  const productionValue = r.float();
  const scamRaw = r.float();
  const scamFactor = scamRaw < 0.5 ? scamRaw * 0.6 : 0.3 + (scamRaw - 0.5) * 1.4;
  const clonedFrom = Math.floor(r.float() * 6) & 0xFF;
  const flair = Math.floor(r.float() * 16) & 0xFF;
  const mascotSeed = r.u32();
  const roadmapSeed = r.u32();
  const heroSeed = r.u32();
  const teamRoll = r.float();
  const teamKind = teamRoll < 0.55 ? 0 : teamRoll < 0.80 ? 1 : teamRoll < 0.92 ? 2 : teamRoll < 0.96 ? 3 : 4;
  const hasHoneypot = scamFactor > 0.8 && r.float() < 0.5;
  const hasFakeStaking = scamFactor > 0.6 && r.float() < 0.35;
  const wpRoll = r.float();
  const whitepaperKind = scamFactor > 0.8 ? (wpRoll < 0.6 ? 2 : 0)
    : scamFactor > 0.5 ? (wpRoll < 0.5 ? 1 : 2)
    : (wpRoll < 0.7 ? 3 : 1);
  return { tokenId, productionValue, scamFactor, clonedFrom, flair, mascotSeed, roadmapSeed, heroSeed, teamKind, hasHoneypot, hasFakeStaking, whitepaperKind };
}

interface AdSlot { id: number; placement: number; advertiserTokenId: number; leaseEndsRealMs: number; isScam: boolean }

function seedAdSlots(): AdSlot[] {
  const placements = [0,0,1,1,2,2,3,3];
  return placements.map((p, i) => ({ id: i, placement: p, advertiserTokenId: 0xFFFFFFFF, leaseEndsRealMs: 0, isScam: false }));
}

// ─── CEX ────────────────────────────────────────────────────────────────

const CEX_COUNT = 5;
const CEX_MAX_LISTINGS = 64;

interface CexExchange { id: number; name: string; kycLevel: number; fee: number; listedTokens: number[] }
interface CexHolding { tokenId: number; amount: number; avgBuyPrice: number }
interface CexBalance { cexId: number; usdBalance: number; holdings: CexHolding[] }

const CEX_RECIPES: Array<{ name: string; kyc: number; fee: number }> = [
  { name: "Coinbase", kyc: 0.85, fee: 0.0060 },
  { name: "Binance",  kyc: 0.50, fee: 0.0010 },
  { name: "Kraken",   kyc: 0.70, fee: 0.0026 },
  { name: "KuCoin",   kyc: 0.30, fee: 0.0010 },
  { name: "Bybit",    kyc: 0.35, fee: 0.0010 },
];

function seedCexes(runId: bigint, tokenCount: number): CexExchange[] {
  const rng = new Rng(runId ^ 0xCEC0BE1700000000n);
  const out: CexExchange[] = [];
  for (let i = 0; i < CEX_COUNT; i++) {
    const r = CEX_RECIPES[i];
    const listed: number[] = [];
    const target = 24 + Math.floor(rng.float() * 24);
    let attempts = 0;
    while (listed.length < target && attempts < 200 && listed.length < CEX_MAX_LISTINGS) {
      attempts++;
      const candidate = r.kyc > 0.6
        ? Math.floor(rng.float() * rng.float() * tokenCount)
        : Math.floor(rng.float() * tokenCount);
      const tok = candidate >= tokenCount ? Math.max(0, tokenCount - 1) : candidate;
      if (!listed.includes(tok)) listed.push(tok);
    }
    out.push({ id: i, name: r.name, kycLevel: r.kyc, fee: r.fee, listedTokens: listed });
  }
  return out;
}

// ─── Social / Telegram / Forums / News / Alpha ──────────────────────────

const POST_RING_SIZE = 4096;
const TG_CHANNEL_CAP = 256;
const NEWS_RING_SIZE = 256;
const ALPHA_LEAK_RING = 64;

interface SocialPost {
  seq: number; realMs: number; authorWalletId: number; kind: number;
  relatedTokenId: number; templateId: number; textSeed: number;
  likes: number; retweets: number;
}
interface SocialRing { entries: Array<SocialPost | undefined>; nextSeq: number }

function ringPush(r: SocialRing, p: Omit<SocialPost, 'seq'>): void {
  const slot = r.nextSeq % POST_RING_SIZE;
  r.entries[slot] = { ...p, seq: r.nextSeq };
  r.nextSeq += 1;
}

function ringRecent(r: SocialRing, max: number): SocialPost[] {
  const total = r.nextSeq - 1;
  const cap = Math.min(max, total);
  if (cap <= 0) return [];
  const out: SocialPost[] = [];
  for (let i = 0; i < cap; i++) {
    const seq = r.nextSeq - 1 - i;
    const slot = seq % POST_RING_SIZE;
    const e = r.entries[slot];
    if (e) out.push(e);
  }
  return out;
}

function usdToBucket(usd: number): number {
  if (usd < 10_000) return 0;
  if (usd < 50_000) return 1;
  if (usd < 250_000) return 2;
  return 3;
}

interface TGChannel {
  id: number; handle: string; title: string;
  kind: number; adminWalletId: number;
  memberCount: number; subscribed: boolean;
  signalQuality: number; inviteOnly: boolean;
}

const TG_HANDLES = ["@cryptodaily","@whalewatch","@alphagroup","@degenchat","@pancake_pumps","@solana_apes","@eth_maxis","@btc_traders","@rug_radar","@audit_daily","@listings_alerts","@nft_floor","@otc_desk_premium","@mev_observatory","@gas_alerts","@news_unfiltered","@rektnews","@dev_signals","@cartel_news","@inner_circle","@mooncalls","@trenches","@biz_daily","@kyc_dodgers","@otc_eth","@otc_btc","@otc_solana","@otc_obscure","@onchain_intel","@pumps_unfiltered","@degen_grad","@dao_signals"];
const TG_TITLES = ["Crypto Daily Recap","Whale Watcher Pro","Alpha Group VIP","Degen Chat","Pancake Pumps","Solana Apes","ETH Maxis","BTC Traders","Rug Radar","Audit Daily","Listings Alerts","NFT Floor Watch","OTC Desk (Premium)","MEV Observatory","Gas Alerts","News Unfiltered","Rekt News","Dev Signals (LEAKED)","Cartel News","Inner Circle","Moon Calls Free","The Trenches","/biz/ Daily","KYC Dodgers","OTC ETH","OTC BTC","OTC Solana","OTC Obscure","On-Chain Intel","Pumps Unfiltered","Degen Grad School","DAO Signals"];
const TG_KINDS = [0,0,5,1, 2,1,1,1, 0,0,0,0, 3,0,0,0, 0,5,2,5, 2,1,0,1, 3,3,3,3, 0,2,5,0];

interface NpcSeed { id: number; profile: string }

const NPC_PROFILE_NAMES = ['retail','swing','whale','alpha','dev_insider','mev_bot','rug_runner','paper_hands','cartel'];

function seedTgChannels(npcs: NpcSeed[], runId: bigint): TGChannel[] {
  const rng = new Rng(runId ^ 0xEFE0BA0000000000n);
  const out: TGChannel[] = [];
  const rosterSize = Math.max(1, npcs.length);
  for (let i = 0; i < TG_HANDLES.length && i < TG_CHANNEL_CAP; i++) {
    const idx = rng.intRange(rosterSize - 1);
    const npc = npcs[idx] ?? { id: 0, profile: 'retail' };
    const profileIdx = NPC_PROFILE_NAMES.indexOf(npc.profile);
    let signalQuality = 0.5;
    switch (profileIdx) {
      case 3: signalQuality = 0.85 + rng.float() * 0.1; break;
      case 4: signalQuality = 0.6 + rng.float() * 0.2; break;
      case 2: signalQuality = 0.55 + rng.float() * 0.2; break;
      case 5: signalQuality = 0.5; break;
      case 8: signalQuality = 0.4 + rng.float() * 0.2; break;
      case 1: signalQuality = 0.4; break;
      case 0: signalQuality = 0.25; break;
      case 7: signalQuality = 0.15; break;
      case 6: signalQuality = 0.1 + rng.float() * 0.15; break;
    }
    out.push({
      id: i, handle: TG_HANDLES[i], title: TG_TITLES[i],
      kind: TG_KINDS[i], adminWalletId: npc.id,
      memberCount: 100 + Math.floor(rng.float() * rng.float() * 250_000),
      subscribed: false, signalQuality, inviteOnly: TG_KINDS[i] === 5,
    });
  }
  return out;
}

interface ForumBoard { forumId: number; name: string; description: string; threadCount: number }

const FORUM_BOARD_RECIPES: Array<{ forum: number; name: string; description: string }> = [
  { forum: 0, name: "Announcements",     description: "Project ANNs + token launches" },
  { forum: 0, name: "Trading Discussion", description: "Price talk + TA + market chatter" },
  { forum: 0, name: "Marketplace",        description: "Goods + services + escrow" },
  { forum: 0, name: "Scam Accusations",   description: "Receipts on rug-pull projects" },
  { forum: 1, name: "Tools + APIs",       description: "Trading bots, scrapers, dashboards" },
  { forum: 1, name: "Mining Hardware",    description: "Rig builds + hash benchmarks" },
  { forum: 1, name: "Smart Contracts",    description: "Audit reports + exploits" },
  { forum: 1, name: "Off-Topic",          description: "Anything else" },
  { forum: 2, name: "/biz/",              description: "Pure shill territory" },
  { forum: 2, name: "/g/",                description: "Tech" },
  { forum: 2, name: "/pol/",              description: "Politics + tinfoil" },
  { forum: 2, name: "Catalog",            description: "All threads" },
  { forum: 3, name: "r/CryptoCurrency",   description: "General crypto subreddit" },
  { forum: 3, name: "r/SatoshiStreetBets",description: "Memecoin gambling den" },
  { forum: 3, name: "r/defi",             description: "DeFi protocols + yield" },
  { forum: 3, name: "r/Buttcoin",         description: "Skeptics + rug post-mortems" },
  { forum: 4, name: "Vendor List",        description: "Sellers + escrow ratings" },
  { forum: 4, name: "Off-Truck",          description: "Used hardware, no questions" },
  { forum: 4, name: "Custom Code",        description: "Scripts + sniper bots + 0days" },
  { forum: 4, name: "Payments",           description: "OTC + mixer + payouts" },
];

function seedForumBoards(): ForumBoard[] {
  return FORUM_BOARD_RECIPES.map((r) => ({ forumId: r.forum, name: r.name, description: r.description, threadCount: 0 }));
}

interface NewsArticle { id: number; realMs: number; kind: number; relatedTokenId: number; headlineSeed: number; bodySeed: number }
interface NewsRing { entries: Array<NewsArticle | undefined>; nextSeq: number }
function newsRecent(r: NewsRing, max: number): NewsArticle[] {
  const total = r.nextSeq - 1;
  const cap = Math.min(max, total);
  if (cap <= 0) return [];
  const out: NewsArticle[] = [];
  for (let i = 0; i < cap; i++) {
    const seq = r.nextSeq - 1 - i;
    const slot = seq % NEWS_RING_SIZE;
    const e = r.entries[slot];
    if (e) out.push(e);
  }
  return out;
}

interface AlphaLeak { seq: number; npcId: number; tokenId: number; realMsLeaked: number; realMsFires: number; correct: boolean; isFake: boolean }
interface AlphaRing { entries: Array<AlphaLeak | undefined>; nextSeq: number }
function alphaRecent(r: AlphaRing, max: number): AlphaLeak[] {
  const total = r.nextSeq - 1;
  const cap = Math.min(max, total);
  if (cap <= 0) return [];
  const out: AlphaLeak[] = [];
  for (let i = 0; i < cap; i++) {
    const seq = r.nextSeq - 1 - i;
    const slot = seq % ALPHA_LEAK_RING;
    const e = r.entries[slot];
    if (e) out.push(e);
  }
  return out;
}

// ─── Engine state ───────────────────────────────────────────────────────

interface EngineState {
  runId: bigint;
  seeded: boolean;
  symbolToId: Map<string, number>;
  idToSymbol: Map<number, string>;
  tokenCount: number;
  staking: StakingPool[];
  upgrades: Upgrade[];
  ownedHw: number[];
  mining: MiningRig[];
  lp: LpPosition[];
  favors: PumpFavor[];
  rep: RepEntry[];
  tokenSites: TokenSite[];
  adSlots: AdSlot[];
  cexes: CexExchange[];
  cexBalances: CexBalance[];
  social: SocialRing;
  tgChannels: TGChannel[];
  forumBoards: ForumBoard[];
  news: NewsRing;
  alpha: AlphaRing;
}

const state: EngineState = {
  runId: 0n,
  seeded: false,
  symbolToId: new Map(),
  idToSymbol: new Map(),
  tokenCount: 0,
  staking: [],
  upgrades: [],
  ownedHw: new Array(HW_SLOT_COUNT).fill(0),
  mining: [],
  lp: [],
  favors: [],
  rep: [],
  tokenSites: [],
  adSlots: [],
  cexes: [],
  cexBalances: [],
  social: { entries: new Array(POST_RING_SIZE), nextSeq: 1 },
  tgChannels: [],
  forumBoards: [],
  news: { entries: new Array(NEWS_RING_SIZE), nextSeq: 1 },
  alpha: { entries: new Array(ALPHA_LEAK_RING), nextSeq: 1 },
};

export interface SeedInput {
  runId: bigint;
  tokens: Array<{ id: number; sym: string }>;
  npcs: NpcSeed[];
}

// ─── Public engine surface ─────────────────────────────────────────────

export const engine = {
  /** Seed all cold systems for the given run. Idempotent — safe to call
   *  repeatedly with the same runId; only re-seeds when runId changes. */
  seed(input: SeedInput): void {
    if (state.seeded && state.runId === input.runId) return;
    state.runId = input.runId;
    state.symbolToId.clear();
    state.idToSymbol.clear();
    for (const t of input.tokens) {
      state.symbolToId.set(t.sym, t.id);
      state.idToSymbol.set(t.id, t.sym);
    }
    state.tokenCount = input.tokens.length;
    state.staking = seedStakingPools(state.symbolToId);
    state.upgrades = seedUpgradeMarket(state.runId);
    state.ownedHw = new Array(HW_SLOT_COUNT).fill(0);
    state.mining = [];
    state.lp = [];
    state.favors = [];
    state.rep = [];
    state.tokenSites = input.tokens.map((t) => rollTokenSite(t.id, state.runId));
    state.adSlots = seedAdSlots();
    state.cexes = seedCexes(state.runId, state.tokenCount);
    state.cexBalances = [];
    for (let i = 0; i < CEX_COUNT; i++) state.cexBalances.push({ cexId: i, usdBalance: 0, holdings: [] });
    state.tgChannels = seedTgChannels(input.npcs, state.runId);
    state.forumBoards = seedForumBoards();
    state.social = { entries: new Array(POST_RING_SIZE), nextSeq: 1 };
    state.news = { entries: new Array(NEWS_RING_SIZE), nextSeq: 1 };
    state.alpha = { entries: new Array(ALPHA_LEAK_RING), nextSeq: 1 };
    state.seeded = true;
  },

  /** Forget the seed so the next `seed()` re-rolls. Called on sim reset. */
  invalidate(): void { state.seeded = false; state.runId = 0n },

  /** Periodic cold tick (~10Hz). Drives staking accrual, mining mints,
   *  LP fee distribution, queued favor flips. */
  tickCold(dtMs: number, realMs: number): void {
    if (!state.seeded) return;
    // Staking — pure local accrual.
    if (dtMs > 0) {
      for (const p of state.staking) {
        if (p.myStake > 0 && p.apr > 0) {
          p.myEarned += p.myStake * p.apr * (dtMs / MS_PER_YEAR);
        }
      }
    }
    // Mining — credit player + mint pool + debit power, via zigcall per rig.
    if (dtMs > 0 && state.mining.length > 0) {
      const dtS = dtMs / 1000;
      const hours = dtS / 3600;
      for (const r of state.mining) {
        if (r.targetTokenId === 0xFFFFFFFF) continue;
        if (r.wear >= 1) continue;
        const wearFactor = r.wear < 0.7 ? 1 : 0.5;
        const minted = r.ratePerSec * dtS * wearFactor;
        const power = r.powerCostPerHr * hours;
        const result = zigCall('apply_mining_yield', r.targetTokenId, minted, power);
        if (result?.ok === 1) {
          if (minted > 0) r.totalMined += minted;
          r.wear += dtS * 0.00002;
        }
      }
    }
    // LP — drain fees per pool with positions, distribute to positions.
    if (state.lp.length > 0) {
      const byToken = new Map<number, LpPosition[]>();
      for (const p of state.lp) {
        if (!byToken.has(p.tokenId)) byToken.set(p.tokenId, []);
        byToken.get(p.tokenId)!.push(p);
      }
      for (const [tokenId, positions] of byToken) {
        const fees = zigCall('pool_take_lp_fees', tokenId) ?? 0;
        if (fees > 0) for (const p of positions) p.feesEarned += p.lpShare * fees;
      }
    }
    // Favors — fire pump/dump flips when their windows arrive.
    for (const f of state.favors) {
      if (f.id === 0) continue;
      if (!f.firedPump && realMs >= f.startRealMs) {
        zigCall('set_token_pattern', f.targetTokenId, f.backstab ? 2 : 1);
        f.firedPump = true;
      }
      if (!f.firedDump && realMs >= f.dumpRealMs) {
        zigCall('set_token_pattern', f.targetTokenId, 2);
        f.firedDump = true;
      }
    }
  },

  /** Whale-watch ingestion. Called by sim.ts when a tape row crosses
   *  the $5k threshold and has a non-zero wallet_id. */
  pushWhaleWatch(realMs: number, walletId: number, tokenId: number, usd: number, isBuy: boolean): void {
    if (!state.seeded) return;
    const b = usdToBucket(usd);
    const templateId = isBuy ? (b % 8) : 8 + (b % 8);
    const seed = ((tokenId ^ realMs) >>> 0);
    ringPush(state.social, {
      realMs, authorWalletId: walletId, kind: 2,
      relatedTokenId: tokenId, templateId, textSeed: seed,
      likes: 0, retweets: 0,
    });
  },

  // ─── Staking ──────────────────────────────────────────────────────
  stakingMeta(): Array<{ id: number; name: string; stakedSym: string; rewardSym: string; chain: number }> {
    return state.staking.map((p) => ({ id: p.id, name: p.name, stakedSym: p.stakedSym, rewardSym: p.rewardSym, chain: p.homeChain }));
  },
  snapshot_staking(realMs: number) {
    return state.staking.map((p) => ({
      id: p.id, staked_token_id: p.stakedTokenId, reward_token_id: p.rewardTokenId,
      chain: p.homeChain, apr: p.apr, total_staked: p.totalStaked,
      my_stake: p.myStake, my_earned: p.myEarned,
      lock_ms: p.lockMs, lock_end_ms: p.lockEndMs,
      unlocked: realMs >= p.lockEndMs ? 1 : 0,
      vested: p.vested ? 1 : 0, vested_cap: p.vestedCap,
    }));
  },
  staking_count(): number { return state.staking.length },
  stake(poolId: number, amount: number, realMs: number) {
    if (poolId >= state.staking.length) return { ok: 0, my_stake: 0, my_earned: 0 };
    const p = state.staking[poolId];
    if (amount <= 0) return { ok: 0, my_stake: p.myStake, my_earned: p.myEarned };
    let ok = false;
    if (p.stakedTokenId === ASSET_USDT) {
      if (zigCall('wallet_debit_usd', amount)?.ok === 1) ok = true;
    } else {
      if (zigCall('wallet_debit_holding', p.stakedTokenId, amount)?.ok === 1) ok = true;
    }
    if (ok) {
      p.myStake += amount;
      p.totalStaked += amount;
      p.lockEndMs = realMs + p.lockMs;
    }
    return { ok: ok ? 1 : 0, my_stake: p.myStake, my_earned: p.myEarned };
  },
  unstake(poolId: number, amount: number, realMs: number) {
    if (poolId >= state.staking.length) return { ok: 0, my_stake: 0, my_earned: 0 };
    const p = state.staking[poolId];
    if (amount <= 0 || amount > p.myStake || realMs < p.lockEndMs) return { ok: 0, my_stake: p.myStake, my_earned: p.myEarned };
    if (p.stakedTokenId === ASSET_USDT) {
      zigCall('wallet_credit_usd', amount);
    } else {
      zigCall('wallet_credit_holding', p.stakedTokenId, amount);
    }
    p.myStake -= amount;
    p.totalStaked = Math.max(p.totalStaked - amount, p.myStake);
    return { ok: 1, my_stake: p.myStake, my_earned: p.myEarned };
  },
  harvest(poolId: number) {
    if (poolId >= state.staking.length) return { amount: 0, my_stake: 0, my_earned: 0 };
    const p = state.staking[poolId];
    const out = p.myEarned;
    if (out > 0) {
      p.myEarned = 0;
      zigCall('wallet_credit_usd', out);
    }
    return { amount: out, my_stake: p.myStake, my_earned: p.myEarned };
  },

  // ─── Upgrades + hardware ──────────────────────────────────────────
  upgradeKindNames(): Array<{ value: number; name: string }> {
    return UPGRADE_KIND_NAMES.map((name, value) => ({ value, name }));
  },
  snapshot_upgrades() {
    return state.upgrades.map((u) => ({
      id: u.id, kind: u.kind, tier: u.tier,
      price_token_id: u.priceTokenId, price_amount: u.priceAmount,
      legit: u.legit ? 1 : 0, venue: u.venue, venue_ref: u.venueRef,
      expires_real_ms: u.expiresRealMs,
      purchased: u.purchased ? 1 : 0, vested: u.vested ? 1 : 0, hw_slot: u.hwSlot,
    }));
  },
  snapshot_hardware() {
    const s = state.ownedHw;
    return { monitor: s[0], cpu: s[1], ram: s[2], network: s[3], sound: s[4], gpu: s[5], keyboard: s[6], webcam: s[7] };
  },
  buy_upgrade(upgradeId: number) {
    const u = state.upgrades.find((x) => x.id === upgradeId);
    let ok = false;
    if (u && !u.purchased && u.priceTokenId === ASSET_USDT) {
      if (zigCall('wallet_debit_usd', u.priceAmount)?.ok === 1) {
        u.purchased = true;
        const slot = HW_SLOT_FOR_KIND[UPGRADE_KIND_NAMES[u.kind]];
        if (slot !== undefined && u.tier > state.ownedHw[slot]) state.ownedHw[slot] = u.tier;
        ok = true;
      }
    }
    return { ok: ok ? 1 : 0, monitor_tier: state.ownedHw[0] };
  },
  set_hardware_tier(slot: number, tier: number): number {
    if (slot >= HW_SLOT_COUNT) return 0;
    state.ownedHw[slot] = tier;
    return 1;
  },

  // ─── Mining ───────────────────────────────────────────────────────
  snapshot_mining() {
    return state.mining.map((r, i) => ({
      id: r.id || (i + 1), tier: r.tier,
      target_token_id: r.targetTokenId,
      rate_per_sec: r.ratePerSec,
      power_cost_per_hr: r.powerCostPerHr,
      total_mined: r.totalMined, wear: r.wear,
      installed_real_ms: r.installedRealMs,
    }));
  },
  mining_count(): number { return state.mining.length },
  install_mining_rig(tier: number, targetTokenId: number, realMs: number): number {
    if (state.mining.length >= MINING_RIG_CAP) return 0;
    const safeTier = Math.min(Math.max(tier, 0), 5);
    const slot = state.mining.length;
    state.mining.push({
      id: slot + 1, tier: safeTier,
      targetTokenId,
      ratePerSec: TIER_RATE[safeTier],
      powerCostPerHr: TIER_POWER[safeTier],
      totalMined: 0, wear: 0,
      installedRealMs: realMs,
    });
    return slot + 1;
  },
  repoint_mining_rig(rigIdx: number, newTargetTokenId: number): number {
    if (rigIdx >= state.mining.length) return 0;
    state.mining[rigIdx].targetTokenId = newTargetTokenId;
    return 1;
  },

  // ─── Web ──────────────────────────────────────────────────────────
  snapshot_token_sites() {
    return state.tokenSites.map((t) => ({
      token_id: t.tokenId,
      production_value: t.productionValue, scam_factor: t.scamFactor,
      cloned_from: t.clonedFrom, flair: t.flair,
      mascot_seed: t.mascotSeed, roadmap_seed: t.roadmapSeed, hero_seed: t.heroSeed,
      team_kind: t.teamKind,
      has_honeypot: t.hasHoneypot ? 1 : 0,
      has_fake_staking: t.hasFakeStaking ? 1 : 0,
      whitepaper_kind: t.whitepaperKind,
    }));
  },
  snapshot_ad_slots() {
    return state.adSlots.map((a) => ({
      id: a.id, placement: a.placement,
      advertiser_token_id: a.advertiserTokenId,
      lease_ends_real_ms: a.leaseEndsRealMs,
      is_scam: a.isScam ? 1 : 0,
    }));
  },

  // ─── CEX ──────────────────────────────────────────────────────────
  snapshot_cexes() {
    return state.cexes.map((c) => ({ id: c.id, kyc_level: c.kycLevel, fee: c.fee, listed_count: c.listedTokens.length }));
  },
  snapshot_cex_balance(cexId: number) {
    if (cexId >= CEX_COUNT) return { cex_id: 0, usd_balance: 0, holding_count: 0 };
    const b = state.cexBalances[cexId];
    return { cex_id: b.cexId, usd_balance: b.usdBalance, holding_count: b.holdings.length };
  },
  cex_deposit(_c: number, _t: number, _a: number) { return { ok: 0 } },
  cex_withdraw(_c: number, _t: number, _a: number) { return { ok: 0 } },
  cex_buy(_c: number, _t: number, _u: number) { return { ok: 0 } },
  cex_sell(_c: number, _t: number, _b: number) { return { ok: 0 } },

  // ─── Social / Telegram / Forums / News / Alpha ────────────────────
  snapshot_social(max: number) {
    return ringRecent(state.social, Math.min(max, 64)).map((p) => ({
      seq: p.seq, real_ms: p.realMs,
      author_wallet_id: p.authorWalletId, kind: p.kind,
      related_token_id: p.relatedTokenId, template_id: p.templateId,
      text_seed: p.textSeed, likes: p.likes, retweets: p.retweets,
    }));
  },
  tgChannelMeta(): Array<{ id: number; handle: string; title: string }> {
    return state.tgChannels.map((c) => ({ id: c.id, handle: c.handle, title: c.title }));
  },
  snapshot_tg_channels() {
    return state.tgChannels.map((c) => ({
      id: c.id, kind: c.kind,
      admin_wallet_id: c.adminWalletId,
      member_count: c.memberCount,
      subscribed: c.subscribed ? 1 : 0,
      signal_quality: c.signalQuality,
      invite_only: c.inviteOnly ? 1 : 0,
    }));
  },
  forumBoardMeta(): Array<{ forumId: number; boardIdx: number; name: string; description: string }> {
    return state.forumBoards.map((b, i) => ({ forumId: b.forumId, boardIdx: i, name: b.name, description: b.description }));
  },
  snapshot_forum_boards() {
    return state.forumBoards.map((b, i) => ({ forum_id: b.forumId, board_idx: i, thread_count: b.threadCount }));
  },
  snapshot_news(max: number) {
    return newsRecent(state.news, Math.min(max, 64)).map((a) => ({
      id: a.id, real_ms: a.realMs, kind: a.kind,
      related_token_id: a.relatedTokenId, headline_seed: a.headlineSeed, body_seed: a.bodySeed,
    }));
  },
  snapshot_alpha(max: number) {
    return alphaRecent(state.alpha, Math.min(max, 32)).map((l) => ({
      seq: l.seq, npc_id: l.npcId, token_id: l.tokenId,
      real_ms_leaked: l.realMsLeaked, real_ms_fires: l.realMsFires,
      correct: l.correct ? 1 : 0, is_fake: l.isFake ? 1 : 0,
    }));
  },

  // ─── LP positions ─────────────────────────────────────────────────
  snapshot_lp() {
    return state.lp.map((p) => ({
      id: p.id, token_id: p.tokenId,
      base_deposited: p.baseDeposited, quote_deposited: p.quoteDeposited,
      lp_share: p.lpShare, fees_earned: p.feesEarned,
      opened_real_ms: p.openedRealMs,
    }));
  },
  add_lp(tokenId: number, usdAmount: number, realMs: number) {
    if (state.lp.length >= LP_POSITION_CAP) return { ok: 0, id: 0 };
    const r = zigCall('apply_lp_add', tokenId, usdAmount);
    if (!r || r.ok !== 1) return { ok: 0, id: 0 };
    const slot = state.lp.length;
    state.lp.push({
      id: slot + 1, tokenId,
      baseDeposited: r.token_amount, quoteDeposited: r.quote_amount,
      lpShare: r.quote_amount / Math.max(1, zigCall('snapshot_prices')?.[tokenId]?.liquidity_usd ?? 1),
      feesEarned: 0, openedRealMs: realMs,
    });
    return { ok: 1, id: slot + 1 };
  },
  remove_lp(positionIdx: number) {
    if (positionIdx >= state.lp.length) return { ok: 0, usd_received: 0 };
    const p = state.lp[positionIdx];
    const usd = zigCall('apply_lp_remove', p.tokenId, p.baseDeposited, p.quoteDeposited, p.feesEarned) ?? 0;
    state.lp.splice(positionIdx, 1);
    for (let i = positionIdx; i < state.lp.length; i++) state.lp[i].id = i + 1;
    return { ok: 1, usd_received: usd };
  },

  // ─── Favors ───────────────────────────────────────────────────────
  snapshot_favors() {
    return state.favors.filter((f) => f.id !== 0).map((f) => ({
      id: f.id,
      granted_by_wallet_id: f.grantedByWalletId,
      target_token_id: f.targetTokenId,
      start_real_ms: f.startRealMs, dump_real_ms: f.dumpRealMs,
      pump_pct: f.pumpPct, rep_cost: f.repCost,
      backstab: f.backstab ? 1 : 0,
      fired_pump: f.firedPump ? 1 : 0,
      fired_dump: f.firedDump ? 1 : 0,
    }));
  },
  consume_favor(tokenId: number, granterWallet: number, realMs: number): number {
    if (state.favors.length >= FAVOR_CAP) return 0;
    const slot = state.favors.length;
    state.favors.push({
      id: slot + 1, grantedByWalletId: granterWallet, targetTokenId: tokenId,
      startRealMs: realMs + 2_000, dumpRealMs: realMs + 2_000 + 30_000,
      pumpPct: 0.50, repCost: 0.10,
      backstab: false, firedPump: false, firedDump: false,
    });
    return slot + 1;
  },

  // ─── Reputation ───────────────────────────────────────────────────
  snapshot_rep() {
    return state.rep.map((r) => ({ wallet_id: r.walletId, score: r.score, interactions: r.interactions }));
  },
  rep_score(walletId: number): number {
    const e = state.rep.find((r) => r.walletId === walletId);
    return e ? e.score : 0.5;
  },
  rep_adjust(walletId: number, delta: number): number {
    if (walletId === 0) return 0;
    let entry = state.rep.find((r) => r.walletId === walletId);
    if (!entry) {
      if (state.rep.length >= REP_CAP) return 0;
      entry = { walletId, score: 0.5, interactions: 0 };
      state.rep.push(entry);
    }
    entry.score = Math.min(1, Math.max(0, entry.score + delta));
    entry.interactions = (entry.interactions + 1) & 0xFFFF;
    return 1;
  },
};

export type EngineApi = typeof engine;
