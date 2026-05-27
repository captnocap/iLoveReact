// DevPage — single-page dump of every shape, constant, hook, action,
// and gameplay rule the codebase has nailed down so far. The Browser
// loads this at `/dev`; treat it as the live reference doc we update
// alongside the sim/components as they grow.

import { Box, Text } from '@reactjit/runtime/primitives';

const TEXT = '#e1e6ef';
const DIM = '#8a93a6';
const MUTED = '#5a6275';
const ACCENT = '#41a8ff';
const HEADER = '#ffd166';
const CODE_BG = 'rgba(255,255,255,0.04)';
const SECTION_BG = 'rgba(255,255,255,0.02)';
const RULE = '#272d3a';

// ── leaf renderers ─────────────────────────────────────────────────────

function H1({ children }: { children: any }) {
  return <Text style={{ fontSize: 26, color: HEADER, fontWeight: 'bold' }}>{children}</Text>;
}
function H2({ children }: { children: any }) {
  return <Text style={{ fontSize: 16, color: ACCENT, fontWeight: 'bold', marginTop: 14 }}>{children}</Text>;
}
function H3({ children }: { children: any }) {
  return <Text style={{ fontSize: 13, color: '#c0c8d7', fontWeight: 'bold', marginTop: 6 }}>{children}</Text>;
}
function P({ children }: { children: any }) {
  return <Text style={{ fontSize: 12, color: TEXT, lineHeight: 17 }}>{children}</Text>;
}
function Muted({ children }: { children: any }) {
  return <Text style={{ fontSize: 11, color: DIM }}>{children}</Text>;
}
function Code({ children }: { children: any }) {
  return (
    <Box style={{ backgroundColor: CODE_BG, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 4, borderLeftWidth: 3, borderColor: ACCENT }}>
      <Text style={{ fontSize: 11, color: '#cdd6f4', fontFamily: 'monospace', lineHeight: 16 }}>{children}</Text>
    </Box>
  );
}
function Bullet({ children }: { children: any }) {
  return (
    <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 4 }}>
      <Text style={{ fontSize: 12, color: MUTED }}>•</Text>
      <Text style={{ fontSize: 12, color: TEXT, flexGrow: 1, lineHeight: 16 }}>{children}</Text>
    </Box>
  );
}
function Section({ title, children }: { title: string; children: any }) {
  return (
    <Box style={{ flexDirection: 'column', gap: 6, padding: 14, borderRadius: 8, backgroundColor: SECTION_BG, borderWidth: 1, borderColor: RULE }}>
      <H2>{title}</H2>
      {children}
    </Box>
  );
}

// ── the page ───────────────────────────────────────────────────────────

export function DevPage() {
  return (
    <Box style={{ flexDirection: 'column', gap: 14, maxWidth: 900 }}>
      <H1>Shitcoin Roguelike — Dev Reference</H1>
      <Muted>This page is the living dump of every data shape, constant, hook, and gameplay rule we have shipped. Edit it alongside the code so future-us can read instead of grep.</Muted>

      {/* ── PREMISE ───────────────────────────────────────── */}
      <Section title="Premise">
        <P>Reach $1M starting from $1k inside a procedurally-seeded 2021-era memecoin desktop. The player sits in an OS, opens a browser, visits fake dapps. Death of the run = ruin; meta-progression comes from a small set of vested staking pools and (eventually) shop upgrades.</P>
        <Bullet>Every run rolls a fresh 64-bit run_id. Tokens, NPCs, pool depths, supply distributions, rug timing, chain assignments — all derive from it. Same id = byte-identical replay (commit-reveal leaderboards). Different id = different world.</Bullet>
        <Bullet><Text style={{ fontWeight: 'bold' }}>Symbols are labels, not destinies.</Text> "WGMI" might be a deep-pool blue-chip on Ethereum one run and a thin rug-rigged shitcoin on Fantom the next. There's no "WGMI always goes up" — the only ticker characteristics that survive a run are the letters themselves.</Bullet>
        <Bullet>Player wallet uses OS CSPRNG (NOT run_id-derived) so every account is globally unique — 2^-160 collision odds. That's the leaderboard key.</Bullet>
        <Bullet>NPC wallets ARE run_id-derived, so the population changes per run. Same profile mix (512 NPCs, retail/whale/alpha/etc.), different addresses + balances + behaviour.</Bullet>
        <Bullet>Difficulty escalates with bankroll: more rugs, more MEV, larger copy-trade cascades.</Bullet>
      </Section>

      {/* ── RUN-ID / RANDOMIZATION ───────────────────────── */}
      <Section title="Run-id & randomization">
        <P>One 64-bit seed (<Text style={{ fontFamily: 'monospace', color: ACCENT }}>g_state.run_id</Text>) anchors all procedural rolls. Generated from OS entropy on first init and on every <Text style={{ fontFamily: 'monospace' }}>sim.reset()</Text>. Cart can pin a specific id BEFORE first init (or before next reset) for daily-challenge / replay modes.</P>
        <Code>
{`g_state.run_id   u64    fresh entropy on init/reset (or pinned)

Subsystem salts:
  token        = run_id ^ 0xA5A5_C0DE_0000_0000 ^ token_index
  supply       = run_id ^ 0xB1_5AF_E000_0000    ^ token_index
  npc roster   = run_id (sim Rng — flows directly)
  market mood  = run_id (sim Rng)

PLAYER wallet  = std.crypto.random.bytes(20)   ← NOT keyed off run_id`}
        </Code>
        <H3>Cart surface</H3>
        <Code>
{`sim.runId()                → "0xab12cd34ef567890"
sim.setRunId(hex | 'fresh') → pin specific id, or clear pin
sim.reset()                 → fresh id (unless re-pinned after)`}
        </Code>
        <Muted>Implication: NO descriptive copy anywhere ("SHIT is the rug-king", "MOON pumps every run") because the underlying characteristics will be different next time. UI should describe what a token IS doing right now, never what it "always" does.</Muted>
      </Section>

      {/* ── GAME TIME ─────────────────────────────────────── */}
      <Section title="Game time scale">
        <P>One real minute = one 24h "game day". Every drift-time subsystem derives from a single knob.</P>
        <Code>
{`GAME_DAY_MS      = 60_000          // 1 real min = 1 game day
GAME_HOUR_MS     = 2_500
MARKET_TICK_MS   = 5_000           // mood every 2 game hours
PATTERN_TICK_MS  = 600             // 100 progress steps / game day
VOLUME_DECAY     = 0.5^(MARKET_TICK_MS / GAME_DAY_MS)
                 // → volume_24h has half-life of one game day`}
        </Code>
        <Muted>NPC trade rates + MEV reaction stay in REAL time so the tape feels like a real market even when the day is compressed.</Muted>
      </Section>

      {/* ── SIM ENGINE ───────────────────────────────────── */}
      <Section title="Sim engine — top-level shape">
        <P>The sim runs in Zig (<Text style={{ fontFamily: 'monospace', color: ACCENT }}>framework/sim/</Text>) and is driven by <Text style={{ fontFamily: 'monospace', color: ACCENT }}>engine.tick(dt_ms)</Text>. The cart pulls via <Text style={{ fontFamily: 'monospace', color: ACCENT }}>__zig_call('sim', fn, …)</Text>.</P>
        <Code>
{`MAX_TOKENS           = 256
STARTUP_TOKEN_COUNT  = 256    // full fleet on boot
TICK_MS              = 100    // engine cadence
MAX_TPS_GLOBAL       = 60     // tape rate ceiling
MAX_STAKING_POOLS    = 64
MAX_HOLDINGS         = 64`}
        </Code>
        <P>Each token in <Text style={{ fontFamily: 'monospace', color: ACCENT }}>g_state.tokens[i]</Text> bundles a price-engine state, an AMM pool, a chain, and its own Poisson schedule.</P>
        <Code>
{`Token {
  price: PriceState     // pattern, current, ath/atl, candles
  pool:  Pool           // x*y=k AMM
  symbol, home_chain
  next_event_at_ms      // per-token Poisson tick
  rate_boost            // multiplicative, decays toward 1.0
}`}
        </Code>
      </Section>

      {/* ── PRICE / PATTERN ───────────────────────────────── */}
      <Section title="Price patterns + base rates">
        <H3>Pattern enum</H3>
        <Code>
{`crab | pump | dump | organic_up | organic_down | volatile | rug`}
        </Code>
        <H3>Base trade rate (events/sec per token)</H3>
        <Code>
{`pump          5.0
dump          3.0
volatile      8.0
crab          0.6
organic_up    1.2
organic_down  1.0
rug           0.1       // residual post-rug only`}
        </Code>
        <P>Pattern transitions roll on PATTERN_TICK_MS. Rug roll fires globally; on rug the pool quote-side is multiplied by 0.02 (≈98% drop) and the price is re-synced to spot.</P>
        <P><Text style={{ fontWeight: 'bold' }}>Band bias</Text>: when price drifts toward a bucket edge (micro/small/mid/large/blue), trade direction biases back — micro can flex 500% up / 95% down, blue chips only ±15%.</P>
      </Section>

      {/* ── AMM POOL ──────────────────────────────────────── */}
      <Section title="AMM pool — pool.zig">
        <P>Constant-product x·y=k per token. Pool is quoted against a <Text style={{ fontWeight: 'bold' }}>base coin</Text> (USDT/BNB/ETH/etc.); USD value is derived through the base coin's USD price.</P>
        <Code>
{`Pool {
  token_id, base_coin
  reserve_base         // token side (LP-locked)
  reserve_quote        // base-coin side
  fee                  // typically 0.003 (0.3%)
  volume_24h           // base-coin units, EMA-decayed each market tick
  tx_count_24h
  total_supply         // fixed at seed; ONLY grows via mintForEmission
  emitted_as_reward    // cumulative tokens minted into staking rewards
  circulating_supply   // legacy alias for market-cap denom (= total + emitted)
  is_rugged
}`}
        </Code>
        <H3>Supply invariant (alignment rule)</H3>
        <Code>
{`total_supply + emitted_as_reward
  = reserve_base                       (LP-locked)
  + player_held                        (wallet.holdings)
  + npc_held    (sum over npcs)        (NpcHolding.amount)
  + staked      (across all staking)   (StakingPool.my_stake + NPC stakes TBD)
  + unclaimed_rewards                  (StakingPool.my_earned, etc.)`}
        </Code>
        <P>Keeping this aligned prevents the "dunk a huge bag on the AMM cheap, then dump on later emissions" arbitrage. New tokens entering circulation via staking rewards inflate the supply side, so price marks down accordingly when fresh rewards hit the wallet. The invariant must hold at every tick boundary — every layer (AMM, wallet, staking, NPCs) writes through the same accounting paths.</P>
        <H3>Slippage envelope</H3>
        <Code>
{`max_frac =  base_volatility * 1.5
         + pattern_bonus   // volatile +0.10, pump/dump +0.05
frac     =  rng() * rng() * max_frac * natural_size_scale`}
        </Code>
        <Muted>Calibrated to real DEX tiers — stablecoin swaps ~0.1–0.5%, blue alts ~1–3%, normal shitcoins ~5–15%, volatile shitcoins ~15–25%.</Muted>
      </Section>

      {/* ── CHAIN ECOSYSTEM ───────────────────────────────── */}
      <Section title="Chains + base coins">
        <P>13 base coins seeded with rough real-world USD anchors. Each chain has a typical DEX TVL fraction that sets default pool depth.</P>
        <Code>
{`Base coins: BTC ETH SOL BNB AVAX FTM ADA TRX MATIC LTC XMR USDT USDC

Chain pool-depth defaults (USD):
  ethereum  300k   bsc       80k   solana    100k
  arbitrum   60k   base      40k   polygon    50k
  avalanche  30k   tron      20k   cardano    10k
  fantom      8k   litecoin   5k   monero      2k
  bitcoin   100k (wrapped)

Token chain distribution (per 100):
  bsc 25  eth 20  sol 20  matic 10  arb 5
  base 5  avax 5  ftm 5   trx 5`}
        </Code>
      </Section>

      {/* ── TAPE / REACTIVE ───────────────────────────────── */}
      <Section title="NPC tape + reactive events">
        <P>Each token marches at its own Poisson cadence. Global TPS throttle caps total events/sec regardless of fleet size; over-budget events defer to next 1-second window.</P>
        <P><Text style={{ fontWeight: 'bold' }}>Reactive triggers</Text> when a player trade is large or impactful (more than $5k or more than 1% price impact):</P>
        <Bullet>MEV arb — capped at 45% of player impact, never inverts direction.</Bullet>
        <Bullet>1–3 copy-trade bots — same-direction follow-ons.</Bullet>
        <P><Text style={{ fontWeight: 'bold' }}>Player heat</Text> = log10(bankroll/$1k) + trade_factor → multiplies rug chance + reaction magnitudes. The shop (TBD) is the counter-action.</P>
      </Section>

      {/* ── NPC ROSTER ────────────────────────────────────── */}
      <Section title="NPC roster — npc.zig">
        <P>Every NPC trade has a wallet behind it. Tape events carry a <Text style={{ fontFamily: 'monospace', color: ACCENT }}>walletId</Text> field (1-based; 0 = unattributed / player); cart joins by id against the init-emitted address+profile map.</P>
        <Code>
{`NPC_ROSTER_SIZE   = 512
NPC_MAX_HOLDINGS  = 16        // per-NPC sparse bag

Npc {
  id          // 1-based; 0 reserved
  address     // 20 bytes, RNG-seeded → "0x…"
  profile     // see enum below
  usd_balance, starting_usd
  holdings: NpcHolding[16]
  realized_pnl, trade_count
  rep_score   // 0..1; alpha → 1, paper → low
}

NpcHolding {
  token_id, amount
  avg_buy_price, total_invested
  realized_pnl
}`}
        </Code>
        <H3>Profile mix (per 512)</H3>
        <Code>
{`retail        256    // tiny bag, slow, panic-sells
swing          77    // mid bag, rotates
whale          15    // huge bag, market-shaping
alpha           5    // near-perfect; the "few" players can follow
dev_insider    15    // sells own tokens; tied to rugs
mev_bot        26    // arbitrages player + whale trades
rug_runner     15    // pumps then dumps
paper_hands    77    // buys, panic-sells small drops
cartel         26    // coordinated big bag`}
        </Code>
        <H3>Starting capital by profile (USD)</H3>
        <Code>
{`retail       $100  – $2.1k
paper_hands  $200  – $3k
swing        $5k   – $30k
mev_bot      $50k  – $150k     (kept liquid)
rug_runner   $2k   – $12k
dev_insider  $20k  – $100k
alpha        $50k  – $250k
cartel       $200k – $700k
whale        $1M   – $5M`}
        </Code>
        <Muted>Selection is uniform-random today (npc.pickForTrade), gated only by "buying NPC needs cash". Profile-aware weighting — whales for big trades, retail for small, alpha for prescient buys, dev_insider for rug-triggers — is the next pass; the wiring point exists.</Muted>
        <H3>Bridge surface</H3>
        <Code>
{`sim.npcCount()              → 512
sim.npcRange(start, count)  → Npc[]   (page; cap 128 / call)
sim.npcMeta(walletId)       → { address, profile } | undefined
useNpcRange(start, count)   → Npc[]
useNpcById(walletId)        → { address, profile } | undefined

// Per-tape attribution:
TapeEntry.walletId  // 0 = player / unattributed; >0 indexes roster`}
        </Code>
      </Section>

      {/* ── WALLET ────────────────────────────────────────── */}
      <Section title="Wallet — wallet.zig + cart sim.ts">
        <Code>
{`WalletState {
  address: [20]u8          // EVM-style, OS CSPRNG, unique per run
  usd
  holdings: Holding[64]
  starting_usd, total_value_usd, total_trades
  biggest_win, biggest_loss
}

Holding {
  token_id, symbol
  amount, avg_buy_price
  total_invested, realized_pnl
}`}
        </Code>
        <P>Address is the leaderboard key. <Text style={{ fontFamily: 'monospace', color: ACCENT }}>usePlayerAddress()</Text> reads it cart-side.</P>
      </Section>

      {/* ── STAKING ──────────────────────────────────────── */}
      <Section title="Staking pools — staking.zig">
        <P>Each pool accrues USDT rewards at a fixed APR. Vested pools survive <Text style={{ fontFamily: 'monospace' }}>sim.reset()</Text> (the "new run" boundary), capped per pool; the staked token re-rolls between runs and can rug, zeroing the carryover.</P>
        <Code>
{`StakingPool {
  id, name, chain
  staked_token_id, staked_sym   // ASSET_USDT sentinel = cash
  reward_token_id, reward_sym   // currently always USDT payout
  apr                           // annual fraction; 0.45 = 45%
  total_staked                  // aggregate (NPC float + player)
  my_stake, my_earned
  lock_ms, lock_end_ms          // wall-clock ms in sim domain
  vested: bool
  vested_cap                    // max units that survive reset()
}`}
        </Code>
        <H3>Seeded pools</H3>
        <Code>
{`USDT Saver       eth      8%   no lock
Syrup Pool USDT  bsc     42%   no lock
Locked USDT 7d   bsc    120%   7-day lock   VESTED  $5k cap
DEGEN Farm       bsc    350%   no lock
SHIT Solo        eth    500%   no lock     VESTED  50k cap
MOON Kashi       arb    180%   no lock     VESTED  10k cap
WGMI Yield       base    95%   no lock`}
        </Code>
        <P>APR is real-time annualized — the user-facing yield matches expectation regardless of game-day compression. The vested cap is in <Text style={{ fontWeight: 'bold' }}>staked-token units</Text>, so a $50k SHIT cap is 50,000 SHIT tokens, not $50k of value.</P>
      </Section>

      {/* ── SIM API ──────────────────────────────────────── */}
      <Section title="Sim API (cart side)">
        <Code>
{`sim.currentPrice(id)
sim.tokenCount() / tickCount() / realTimeMs()
sim.quoteBuy(id, usd)        →  QuoteResult
sim.quoteSell(id, amt)       →  QuoteResult
sim.buy(id, usd)             →  TradeResult
sim.sell(id, amt)            →  TradeResult
sim.stake(poolId, amt)       →  StakeResult
sim.unstake(poolId, amt)     →  StakeResult
sim.harvest(poolId)          →  HarvestResult
sim.addRandomToken()         →  new token count
sim.reset()                     // new run; vested stakes carry
sim.npcCount()               →  512
sim.npcRange(start, count)   →  Npc[]   (paginated, cap 128/call)
sim.npcMeta(walletId)        →  { address, profile } | undefined`}
        </Code>
        <H3>Quote / trade shape</H3>
        <Code>
{`QuoteResult  { output, impact, fee, effective_price }
TradeResult  { ok, output, impact, fee, effective_price }
StakeResult  { ok, myStake, myEarned }
HarvestResult{ amount, myStake, myEarned }`}
        </Code>
      </Section>

      {/* ── HOOKS ────────────────────────────────────────── */}
      <Section title="React hooks (cart/shitcoin/sim.ts)">
        <Code>
{`usePriceHistory(tokenId)    →  PriceSample[]   // per-token listener
useLatestPrice(tokenId)     →  PriceSample
useAllLatest()              →  PriceSample[]
useMarket()                 →  Market | null
useWallet()                 →  Wallet | null
useTrades()                 →  Trade[]   // player trades, newest first
useTape(tokenId?)           →  TapeEntry[]  // NPC tape, newest first (carries walletId)
usePlayerAddress()          →  string | null   // "0x…"
useGameTime()               →  GameTime | null
useStakingPool(poolId)      →  StakingPool
useAllStakingPools()        →  StakingPool[]
useNpcRange(start, count)   →  Npc[]
useNpcById(walletId)        →  { address, profile } | undefined`}
        </Code>
        <Muted>All hooks share one rAF loop in sim.ts; throttled to 30Hz notify. Per-token listeners stop the chart-grid fan-out problem at scale.</Muted>
      </Section>

      {/* ── DATA SHAPES ───────────────────────────────────── */}
      <Section title="Cart-side data shapes">
        <Code>
{`PriceSample {
  id, sym, p, t                 // t = monotonic frame seq
  pat: Pattern, rug: bool
  ath, atl
  marketCapUsd, volumeUsd, liquidityUsd
}

Market    { trend: bull|bear|crab, vol, fg, trendAge }
GameTime  { realMs, day, hour, dayMs }

Wallet {
  usd, totalUsd, start, trades
  holdings: Holding[]
}
Holding   { id, sym, amt, avg, inv, upnl, rpnl }

Trade     { seq, kind, id, sym, base, usd, price, fee, impact, t, realMs }
TapeEntry {
  seq, id, sym
  kind: 'buy'|'sell'
  base, usd, price, impact, t
  walletId   // 1-based NPC id; 0 = player / unattributed
}

StakingPool {
  id, name
  stakedTokenId, stakedSym
  rewardTokenId, rewardSym
  apr, totalStaked, myStake, myEarned
  lockMs, lockEndMs, unlocked
  chain
  vested, vestedCap
}

NpcProfile  // 'retail' | 'swing' | 'whale' | 'alpha' | 'dev_insider'
            // | 'mev_bot' | 'rug_runner' | 'paper_hands' | 'cartel'

Npc {
  id              // 1-based; 0 reserved for "no wallet"
  address         // "0x…"
  profile: NpcProfile
  usdBalance, startingUsd
  realizedPnl, tradeCount, holdingCount
  repScore        // 0..1
}`}
        </Code>
      </Section>

      {/* ── REUSABLE COMPONENTS ──────────────────────────── */}
      <Section title="Reusable components — components/">
        <P>Shape-locked, skinnable via classifier variants + theme tokens. Today they all live unmounted while we rebuild the OS shell; the contracts below are stable.</P>
        <Code>
{`DexCard       props: { tokenId, defaultUsdIn?, title?, footer? }
              variants: uniswap, pancake, sushi, dextools
              uses: useLatestPrice, useWallet, sim.quoteBuy/Sell, sim.buy/sell

StakingPool   props: { poolId }
              variants: pancake, sushi
              uses: useStakingPool, useWallet, sim.stake/unstake/harvest

WalletPanel   props: { showHoldings?, title? }
              variants: metamask, phantom, rabby, etherscan
              uses: useWallet, usePlayerAddress

Browser       props: { initialPath?, skin? }
              variants: chrome, brave, firefox
              owns: per-tab <Router local> for URL state

Window        props: { title, x, y, w, h, focused, maximized,
                       onClose, onMin, onMax, onFocus,
                       onTitleMouseDown/Move/Up }
              variants: xp, win7, macos, linux

Desktop       props: { skin?, crtDefault? }
              owns: windows[], dragRef, startOpen, crtOn
              variants: xp, win7, macos, linux`}
        </Code>
      </Section>

      {/* ── SKIN SYSTEM ──────────────────────────────────── */}
      <Section title="Skin system">
        <P><Text style={{ fontFamily: 'monospace', color: ACCENT }}>{`<SkinProvider skin="…">`}</Text> atomically swaps classifier variant + theme token palette for its subtree. One call repaints every component inside.</P>
        <Code>
{`SkinKey:
  default
  uniswap pancake sushi dextools etherscan
  metamask phantom rabby
  xp win7 macos linux
  chrome brave firefox

skinForChain(chain)        → SkinKey by chain enum
applySkin(key)             → setVariant + setTokens + setStyleTokens`}
        </Code>
      </Section>

      {/* ── BROWSER ROUTER ───────────────────────────────── */}
      <Section title="Browser router">
        <P>Each browser tab mounts its own <Text style={{ fontFamily: 'monospace', color: ACCENT }}>{`<Router local initialPath={…}>`}</Text> so back/forward history stays per-tab even when switching tabs. The Browser's URL bar reads <Text style={{ fontFamily: 'monospace' }}>useRoute().path</Text> and writes via <Text style={{ fontFamily: 'monospace' }}>useNavigate().push(p)</Text>.</P>
        <Code>
{`Routes registered today:
  /dev      → DevPage    (this page)
  (everything else falls through to the blank placeholder)`}
        </Code>
        <Muted>Adding a new site = drop a Route inside BrowserTab + register the component. Sites should wrap themselves in their own SkinProvider so the chrome stays the browser's skin while the body takes the dapp's skin.</Muted>
      </Section>

      {/* ── CRT FILTER ───────────────────────────────────── */}
      <Section title="CRT filter + hit-test warp">
        <P>Desktop wraps in <Text style={{ fontFamily: 'monospace' }}>{`<Filter shader="crt" intensity={1} style={{ width:'100%', height:'100%' }}>`}</Text>. Toggle via Start menu → "CRT filter" or <Text style={{ fontFamily: 'monospace' }}>Ctrl+Shift+C</Text>.</P>
        <H3>Barrel math (matches shader exactly)</H3>
        <Code>
{`p          = uv * 2 - 1
p'         = p * (1 + k * |p|²)        // k = 0.15 * intensity
source_uv  = p' * 0.5 + 0.5
// out-of-range source → shader returns transparent`}
        </Code>
        <P>Hit-test in <Text style={{ fontFamily: 'monospace' }}>framework/layout.zig:hitTest</Text> (and the events.zig variants) re-runs this barrel on the incoming pointer so clicks land where the user visually sees the element, not on the pre-warp layout rect.</P>
        <H3>Gotchas (saved memory)</H3>
        <Bullet><Text style={{ fontWeight: 'bold' }}>Filter needs size</Text>. No width/height → 0×0 offscreen texture → silent crash at boot.</Bullet>
        <Bullet><Text style={{ fontWeight: 'bold' }}>Pointer capture for drag</Text>. onMouseDown + onMouseMove + onMouseUp must be on the SAME node. Overlay-based drag does not get capture and freezes the UI.</Bullet>
      </Section>

      {/* ── UPGRADES + HARDWARE ──────────────────────────── */}
      <Section title="Upgrades + Hardware">
        <P>Universal upgrade engine in <Text style={{ fontFamily: 'monospace', color: ACCENT }}>upgrades.zig</Text>. Three effect shapes cover everything: <Text style={{ fontFamily: 'monospace' }}>modulator</Text> (rug_shield / slippage_buffer / hardware tiers), <Text style={{ fontFamily: 'monospace' }}>generator</Text> (mining_rig / lp_position / validator_node / bridge_operator), <Text style={{ fontFamily: 'monospace' }}>one_shot</Text> (pump_favor / insider_tip / rugcheck_override / lawyer_call).</P>
        <Code>
{`UpgradeKind variants (40+):
  // Modulators
  rug_shield, holding_insurance, private_mempool,
  alpha_radar, rugcheck_premium, whale_alerts, contract_audit_view,
  slippage_buffer, deeper_pockets, one_click_swap, fast_withdrawal,
  // Hardware (slot-mutex)
  hw_monitor, hw_cpu, hw_ram, hw_network,
  hw_sound, hw_gpu, hw_keyboard, hw_webcam,
  // Generators
  mining_rig, lp_position, validator_node, bridge_operator,
  // One-shots
  pump_favor, insider_tip, rugcheck_override, lawyer_call,
  // App installers
  app_telegram, app_sniper_bot, app_arb_bot,
  app_honeypot_scanner, app_wallet_tracker,
  app_calculator, app_notepad, app_mev_protector,
  script_dca, script_stop_loss, script_trailing_stop, script_rebalance,
  // Vested meta-progression
  extra_staking_cap, starting_capital, second_wallet

Venue: ad_slot | token_site_feature | forum_thread | social_post |
       social_dm | cex_promo | explorer_widget | telegram_channel`}
        </Code>
        <H3>Hardware slots (mutually exclusive within slot)</H3>
        <Code>
{`monitor   tier 0 = full CRT, 1 = soft CRT, 2+ = no filter
cpu       tier 0 = 1s tick, 1 = 500ms, 2 = 200ms, 3+ = 100ms;
          max script rules 1/3/8/32
ram       tier 0 = 3 wins, 1 = 6 wins, 2+ = 32 wins
network   tier 0 = 5min CEX withdraw, 1 = 2min, 2 = 30s, 3+ = 5s;
          tier 3 enables private_mempool (skip MEV reactions)
sound     tier ≥1 enables notifications
gpu       tier 0 = 1 live chart, 1 = 4, 2+ = 32
keyboard  cosmetic
webcam    decoration / lore filler`}
        </Code>
        <P>Buy handler enforces slot mutex (buying tier 3 supersedes tier 2). Hardware is vested by default — physical, carries across sim.reset(). All gameplay numbers funnel through <Text style={{ fontFamily: 'monospace' }}>hardware_mod.zig</Text> accessors so the upgrade ladder is one place to balance.</P>
        <Muted>SHAPE PASS: 18 starter upgrades seeded per run (3 monitor tiers, CPU/RAM/Network tier-1s, rug_shield, alpha_radar, slippage_buffer, private_mempool, all four installer apps, mining_rig, lp_position, starting_capital, extra_staking_cap). Full procedural venue distribution + scam variants land alongside the web pass.</Muted>
      </Section>

      {/* ── INCOME PATHS ─────────────────────────────────── */}
      <Section title="Income paths">
        <P>Multiple build trees mean different runs feel structurally different:</P>
        <Code>
{`PASSIVE
  Mining rig         buy hardware → mint tokens to wallet each tick
                     uses pool.mintForEmission (honours supply invariant)
                     power cost debits wallet.usd; wear caps lifetime
  LP positions       deposit pair → earn pool.fee × volume × share
                     fees accumulate to pool.lp_fees_pool; tickLp distributes
  Validator          (future) low-yield long-lockup; safe
  Bridge operator    (future) collect bridge fees; rare hack-wipes the stake

ACTIVE / SCRIPTED
  Sniper bot         pattern-flip → auto buy
  Arb bot            CEX↔DEX spread → arbitrage
  DCA / stop-loss / trailing-stop / rebalance — small-rule scripts
  All run on the same useIFTTT bus

ONE-SHOT (social capital)
  Pump favor         queue a pump pattern on a chosen token; backstab risk
  Insider tip        next CEX listing in advance (pump window)
  Rugcheck override  pay an "audit" NPC to vouch for sketchy token
  Lawyer call        (future) defensive vs regulatory FUD

SELF-OPERATED (high effort)
  Deploy your own token / YouTube shill / Telegram pump group
  (future) — directly control the price arrow with karma cost

DEFENSIVE
  rug_shield, holding_insurance, private_mempool
  GPU/CPU/RAM/network tiers as soft caps`}
        </Code>
        <H3>Mining (concrete, wired end-to-end)</H3>
        <Code>
{`MiningRig {
  tier 0..5            // 1× 3070 → rack of 4090s
  target_token_id      // re-pointable
  rate_per_sec         // tokens/sec
  power_cost_per_hr    // USDT debit
  total_mined, wear    // wear ≥0.7 halves rate; ≥1.0 = dead
}

Tier table (rate / power):
  tier 1: 0.02 tok/s, $0.18/hr
  tier 2: 0.05 tok/s, $0.35/hr
  tier 3: 0.12 tok/s, $0.70/hr
  tier 4: 0.28 tok/s, $1.40/hr
  tier 5: 0.60 tok/s, $2.80/hr`}
        </Code>
      </Section>

      {/* ── IFTTT BUS + SCRIPTS ──────────────────────────── */}
      <Section title="IFTTT bus + Scripts">
        <P>Scripts are <Text style={{ fontFamily: 'monospace' }}>(trigger, action, args)</Text> tuples persisted to JSON. Each enabled rule mounts a <Text style={{ fontFamily: 'monospace' }}>useIFTTT(trigger, wrappedAction)</Text> via <Text style={{ fontFamily: 'monospace' }}>RuleRunner</Text>; the wrapper records the fire into the rule's audit ring before dispatching the action through the IFTTT registry.</P>
        <H3>Sim trigger sources (cart/shitcoin/ifttt_sim.ts)</H3>
        <Code>
{`sim:trade:executed[:buy|:sell][:<tokenId>]
sim:trade:reset                       // run-boundary
sim:wallet:milestone:<usd>            // crosses up through threshold
sim:wallet:bankrupted
ach:<id>                              // synthetic, fired by ach:emit:<id>

// Future Zig emit-at-write-site triggers:
sim:price:<id>:above:<usd>            sim:price:<id>:below:<usd>
sim:pattern:any:to:pump               sim:pattern:<id>:to:pump
sim:volume:<id>:spike:<mult>
sim:rug:any                           sim:rug:<id>
sim:tape:big:<usd>                    sim:tape:wallet:<id>:buy
sim:cex:listing:<id>                  sim:cex:spread:<id>:gt:<frac>
sim:staking:harvested                 sim:staking:earned:<poolId>:gt:<usd>
sim:alpha:leak:<walletId>             sim:alpha:leak:any
upgrade:purchased:<kind>              upgrade:hardware:<slot>:<tier>`}
        </Code>
        <H3>Action verbs</H3>
        <Code>
{`trade:buy:<id>:<usd>          trade:sell:<id>:<amt>
stake:stake:<poolId>:<amt>    stake:unstake:<poolId>:<amt>
stake:harvest:<poolId>
cex:deposit:<cexId>:<tokenId>:<amt>
cex:withdraw:<cexId>:<tokenId>:<amt>
cex:buy:<cexId>:<tokenId>:<usd>
cex:sell:<cexId>:<tokenId>:<amt>
ach:emit:<id>                 notify:<text>`}
        </Code>
        <H3>ScriptRule shape</H3>
        <Code>
{`ScriptRule {
  id, label, enabled
  triggerSpec     // 'sim:pattern:any:to:pump'
  actionSpec      // 'trade:buy:$tokenId:$usd:max-impact:$pct'
  args            // { tokenId: 5, usd: 500, pct: 0.10 }
  recentFires     // capped at 32; powers the audit log
}`}
        </Code>
        <Muted>Adding a new script app type (DCA / stop-loss / trailing-stop / rebalance) is a 20-line file declaring trigger + action templates and rendering <Text style={{ fontFamily: 'monospace' }}>&lt;ScriptApp&gt;</Text>. SniperBot and ArbBot are this exact shape.</Muted>
      </Section>

      {/* ── ACHIEVEMENTS ────────────────────────────────── */}
      <Section title="Achievements">
        <P>Per-player unlock store in <Text style={{ fontFamily: 'monospace' }}>achievements.ts</Text>, JSON-persisted under <Text style={{ fontFamily: 'monospace' }}>./shitcoin_achievements.json</Text> keyed by wallet address. Survives sim.reset(). 8 starter achievements:</P>
        <Code>
{`ACH_FIRST_TRADE     execute any swap
ACH_100_TRADES      cumulative 100 player trades
ACH_FIRST_HARVEST   collect staking rewards (TODO: needs Zig harvest emit)
ACH_MILLIONAIRE     totalUsd ≥ $1,000,000
ACH_DIAMOND_HANDS   survive a rug while holding > $10k (hidden)
ACH_BANKRUPT        drop to ≤ $10 total value
ACH_PAPER_HANDS     sell within 5s of buying (hidden)
ACH_FIRST_BOT_BUY   first sniper bot fire`}
        </Code>
        <P><Text style={{ fontFamily: 'monospace' }}>AchievementsListener.tsx</Text> mounts every useIFTTT binding. Steam-adapter stub at <Text style={{ fontFamily: 'monospace' }}>adapters/steam.ts</Text> maps internal ids → Steam keys; thin layer waits for Steamworks SDK.</P>
      </Section>

      {/* ── WEB LAYER ────────────────────────────────────── */}
      <Section title="Web layer — sites + token landing pages + ads">
        <P>Two arrays:</P>
        <Code>
{`Site (registry, 24 canonical domains — stable across runs):
  app.uniswap.org, pancakeswap.finance, sushi.com,
  coinbase.com, binance.com, kraken.com, kucoin.com, bybit.com,
  dextools.io, coingecko.com, etherscan.io,
  x.com, reddit.com,
  bitcointalk.org, 4chan.org/biz, suspicious.market,
  telegram.org, coindesk.com, cointelegraph.com,
  metamask.io, phantom.app, google.com, duckduckgo.com, pcbuilder.io

TokenSite (per token, rolled from run_id ^ token_id):
  production_value 0..1       // polish
  scam_factor 0..1            // bimodal — most projects either legit or sketchy
  cloned_from                 // visual clone index (0 = original)
  flair, mascot_seed, roadmap_seed, hero_seed
  team_kind                   // anon | partial | doxxed | celebrity | dev_insider
  has_honeypot, has_fake_staking
  socials[4]                  // platform + dead/active/scam_clone
  whitepaper_kind             // none | plagiarized | gibberish | real

AdSlot[8]                     // ad inventory; vacant by default`}
        </Code>
      </Section>

      {/* ── CEX ──────────────────────────────────────────── */}
      <Section title="CEX — centralized exchanges">
        <P>Five exchanges seeded per run with curated listing rolls. Player has a separate USDT + holdings balance per CEX; deposit/withdraw moves funds between wallet and exchange.</P>
        <Code>
{`Coinbase   KYC 85% · fee 0.60%  (high-KYC, listing-bias toward lower-id tokens)
Binance    KYC 50% · fee 0.10%
Kraken     KYC 70% · fee 0.26%
KuCoin     KYC 30% · fee 0.10%  (long-tail-friendly)
Bybit      KYC 35% · fee 0.10%

OrderBook depth: 32 bids/asks (matching engine — stub today)
CexBalance: separate from wallet; deposit/withdraw cross the boundary`}
        </Code>
        <Muted>SHAPE PASS: buy/sell/deposit/withdraw return ok=false until the order-book matching engine lands. Listing-pump scheduler also deferred — when it lands it fires `sim:cex:listing:&lt;id&gt;` on the bus and a 2–5× pump on the AMM via the pattern engine.</Muted>
      </Section>

      {/* ── SOCIAL/TG/FORUMS/NEWS/ALPHA ────────────────── */}
      <Section title="Social / Telegram / Forums / News / Alpha">
        <P>Five surfaces; one end-to-end vertical wired today (whale_watch from any NPC trade &gt; $5k auto-posts into the social ring).</P>
        <Code>
{`social.zig         Post ring (4096), 10 PostKinds
                     whale_watch live; meme/chart/alpha/scam_thread stubs
forums.zig         5 forums × 4 boards each; ThreadKind 9 variants
                     (discussion/shill/fud/technical/upgrade_offer/
                      scam_offer/ama/rug_post_mortem/alpha_drop)
telegram.zig       32 seed channels per run; admins picked from NPC roster
                     signal_quality = profile-shaped
                     (alpha 0.85+, rug_runner 0.10-0.25)
news.zig           NewsArticle ring (256); 8 NewsKinds
alpha.zig          AlphaLeak ring (64); scheduleLeaks wire-point on
                     price.advancePattern`}
        </Code>
      </Section>

      {/* ── LP + FAVORS + REPUTATION ────────────────────── */}
      <Section title="LP positions + Favors + Reputation">
        <Code>
{`lp.zig             LpPosition[16] — base_deposited, quote_deposited,
                     lp_share, fees_earned
                   addLiquidity / removeLiquidity / tickLp
                   tickLp distributes pool.lp_fees_pool by share, zeroes
                   pool's accumulator each tick

favors.zig         PumpFavor[16] + InsiderTip[16]
                   consume_favor(token_id) → flips price.pattern to .pump
                   for 30s, then .dump (backstab → .dump immediately)

reputation.zig     NpcRep sparse map (REP_CAP=64), starts neutral 0.5
                   profileGainScale: alpha=0.3 hard to impress,
                     rug_runner=1.2 easy/volatile, paper_hands=1.0
                   Run-local — addresses re-roll on sim.reset`}
        </Code>
      </Section>

      {/* ── DESKTOP APPS ─────────────────────────────────── */}
      <Section title="Desktop apps registry">
        <P>icons.tsx splits apps into <Text style={{ fontFamily: 'monospace' }}>BASE_APPS</Text> (Browser, always present) and <Text style={{ fontFamily: 'monospace' }}>GATED_APPS</Text> (each tagged with a <Text style={{ fontFamily: 'monospace' }}>requiresUpgradeKind</Text>). <Text style={{ fontFamily: 'monospace' }}>useDesktopApps()</Text> hook joins them after filtering by purchased upgrades.</P>
        <Code>
{`Base:     Browser
Gated:
  Telegram      requires app_telegram
  Sniper Bot    requires app_sniper_bot
  Arb Bot       requires app_arb_bot
  Mining Rigs   requires mining_rig`}
        </Code>
        <P>App icons render via <Text style={{ fontFamily: 'monospace' }}>ShaderPixelIcon</Text> — one WGSL quad per icon, palette-swap animations free. Procedural matrices from <Text style={{ fontFamily: 'monospace' }}>pixelMatrixFromSeed(seed, opts)</Text> seeded off the app id, so icons are stable per app, distinct per app.</P>
      </Section>

      {/* ── PRIMITIVES + PIXEL ICONS ────────────────────── */}
      <Section title="Primitive vocabulary">
        <P>One component per behaviour, prop-flexed for variance. Visual differences ride classifier variants. Located at <Text style={{ fontFamily: 'monospace' }}>cart/shitcoin/components/primitives/</Text>:</P>
        <Code>
{`<Card>          header / body / footer / cta slots
<Page>          padded scroll viewport with optional hero
<Feed>          newest-first stream (render-prop)
<Thread>        head post + flat or nested replies
<List>          rows with selection + hover
<Table>         columnar data with headers
<RuleEditor>    trigger spec + action spec form (script apps)
<AuditLog>      time-ordered fires with status pills
<Form>          field + label + validation + submit`}
        </Code>
        <H3>Pixel icons (cart/pixel_icons/)</H3>
        <Code>
{`PixelIcon         N² Box grid — hit-testable per-cell (paint apps)
ShaderPixelIcon   one WGSL quad — default icon path
PixelMatrix       { size, palette: string[], pixels: (number|null)[] }
pixelMatrixFromSeed(seed, { size, paletteSize, baseHue, fillRate, mirror })
  → procedural icons for NPC avatars, mascots, achievements, ads
seedFromString(s) → u32 (djb2)`}
        </Code>
      </Section>

      {/* ── NEXT ─────────────────────────────────────────── */}
      <Section title="Next — once shape is locked, creative content follows">
        <Bullet>Real diegetic dapp sites (Uniswap / PancakeSwap / Sushi / DexTools / Etherscan layouts) routed inside Browser via /uniswap.org etc. Components ready.</Bullet>
        <Bullet>CEX order-book matching engine + listing-pump scheduler — wires cex:buy/sell/listing triggers + arb-bot vertical.</Bullet>
        <Bullet>Zig emit-at-write-site for pattern flips / price thresholds / volume spikes (the threshold-IFTTT triggers we stubbed).</Bullet>
        <Bullet>Alpha leak scheduler — pre-flip Post(kind=alpha) from alpha NPCs, Post(kind=fake_alpha) from rug_runners.</Bullet>
        <Bullet>Full upgrade venue distribution + scam variants + token-priced absurd offers ("send 1000 SHIT to claim alpha radar").</Bullet>
        <Bullet>Mascot generators per TokenSite + NPC avatar pixel-art generators wired to the live identifier hash.</Bullet>
        <Bullet>Token-type variants (reflection, rebase, liquidity, yield-farm, casino, honeypot).</Bullet>
        <Bullet>News scheduler + headline generators per NewsKind.</Bullet>
        <Bullet>Live CoinGecko base-coin seeding on run start (verified open API).</Bullet>
        <Bullet>Daily-seed leaderboard with commit-reveal + replay verification.</Bullet>
        <Bullet>Forum thread + Telegram message generators (per-admin + per-board templates).</Bullet>
      </Section>

      <Box style={{ height: 40 }} />
    </Box>
  );
}
