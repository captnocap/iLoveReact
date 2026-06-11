# cart/shitcoin/

> Directory-based cart with manifest. Built with `./tools/rjit ship shitcoin`. Window size: 980×680, custom chrome.

## What it is

A shitcoin trading tycoon / simulation game. The player trades tokens on an AMM, manages a wallet, stakes in yield farms, runs mining rigs, reads social feeds (Twitter-style, Telegram, forums, news), and writes IFTTT automation scripts. The architecture splits simulation between a **hot path** (Zig-native AMM market simulation at frame rate) and a **cold path** (TypeScript meta-systems like staking, upgrades, mining, social content, CEX listings). A custom `sim.ts` facade bridges both paths into React hooks. The UI is an OS shell (desktop, windows, taskbar, start menu) with a nested browser that has per-tab local routing.

---

## File inventory

### Entry & config

| File | Role |
|------|------|
| `cart/shitcoin/cart.json` | Manifest: `{ name: "Shitcoin", customChrome: true, width: 980, height: 680 }`. |
| `cart/shitcoin/index.tsx` | Entry point. `ThemeProvider` + `Desktop`. Side-effect imports for `ifttt_sim.ts` and `achievements.ts`. |
| `cart/shitcoin/theme.ts` | Default color + style token palette (`APP_COLORS`, `APP_STYLES`). |
| `cart/shitcoin/style.cls.ts` | Global classifier registry — ~35 named UI components with theme-token styles. |

### Simulation layer

| File | Role |
|------|------|
| `cart/shitcoin/sim_engine.ts` | Cold-content engine. Deterministic PRNG-driven meta-systems: staking, upgrades, mining, LP, favors, reputation, CEX, social, news, alpha. |
| `cart/shitcoin/sim.ts` | Hot-path cache + hook facade. Drains Zig AMM tape, polls snapshots, exposes `sim.*` API and `useXxx()` hooks. |
| `cart/shitcoin/ifttt_sim.ts` | IFTTT bridge. Registers sim trigger sources and action verbs onto the global IFTTT registry. |
| `cart/shitcoin/achievements.ts` | Achievement system. 8 achievements, file-persisted per player address. |
| `cart/shitcoin/useScriptRules.ts` | Script rule storage. File-persisted IFTTT rules per `(playerAddress, appId)`. |
| `cart/shitcoin/adapters/steam.ts` | Steamworks adapter stub. Maps achievement IDs to Steam keys. |

### Components

| File | Role |
|------|------|
| `cart/shitcoin/components/index.ts` | Barrel exports. |
| `cart/shitcoin/components/desktop/Desktop.tsx` | Window manager, icon grid, taskbar, start menu, CRT filter. |
| `cart/shitcoin/components/desktop/Desktop.cls.ts` | Desktop skin sheet (xp/win7/macos/linux variants). |
| `cart/shitcoin/components/desktop/Window.tsx` | Window chrome: title bar, min/max/close, absolute positioning. |
| `cart/shitcoin/components/desktop/Window.cls.ts` | Window frame skin sheet. |
| `cart/shitcoin/components/desktop/icons.tsx` | App registry (`BASE_APPS` + `GATED_APPS`) and `useDesktopApps()`. |
| `cart/shitcoin/components/desktop/apps/AchievementsListener.tsx` | Invisible component mounting IFTTT achievement bindings. |
| `cart/shitcoin/components/desktop/apps/ArbBot.tsx` | Thin wrapper over `<ScriptApp>` with CEX↔DEX arb templates. |
| `cart/shitcoin/components/desktop/apps/MiningRig.tsx` | Rig list + install buttons. |
| `cart/shitcoin/components/desktop/apps/ScriptApp.tsx` | Generic rule editor + IFTTT binding shell. |
| `cart/shitcoin/components/desktop/apps/SniperBot.tsx` | Thin wrapper over `<ScriptApp>` with sniper templates. |
| `cart/shitcoin/components/desktop/apps/Telegram.tsx` | Channel list + message pane. |
| `cart/shitcoin/components/browser/Browser.tsx` | Tab manager + per-tab local `<Router>`. Memo-wrapped. |
| `cart/shitcoin/components/browser/Browser.cls.ts` | Browser chrome skin sheet (chrome/brave/firefox variants). |
| `cart/shitcoin/components/browser/pages/DevPage.tsx` | `/dev` reference docs page. |
| `cart/shitcoin/components/dex-card/DexCard.tsx` | Buy/sell swap card. |
| `cart/shitcoin/components/dex-card/DexCard.cls.ts` | DEX skin sheet (uniswap/pancake/sushi/dextools/etherscan). |
| `cart/shitcoin/components/wallet/WalletPanel.tsx` | Wallet balance + holdings list. |
| `cart/shitcoin/components/wallet/WalletPanel.cls.ts` | Wallet skin sheet (metamask/phantom/rabby). |
| `cart/shitcoin/components/staking/StakingPool.tsx` | Yield farm card: APR, stake, harvest. |
| `cart/shitcoin/components/staking/StakingPool.cls.ts` | Staking skin sheet. |
| `cart/shitcoin/components/shared/SkinProvider.tsx` | Applies a skin (variant + colors + styles) imperatively. |
| `cart/shitcoin/components/shared/skins.ts` | Skin presets (`SKINS` record). |
| `cart/shitcoin/components/primitives/Page.tsx` | Page container primitive. |
| `cart/shitcoin/components/primitives/Card.tsx` | Card container primitive. |
| `cart/shitcoin/components/primitives/Feed.tsx` | Feed/list primitive. |
| `cart/shitcoin/components/primitives/Thread.tsx` | Thread/conversation primitive. |
| `cart/shitcoin/components/primitives/List.tsx` | List primitive. |
| `cart/shitcoin/components/primitives/Table.tsx` | Table primitive. |
| `cart/shitcoin/components/primitives/Form.tsx` | Form/input primitive. |
| `cart/shitcoin/components/primitives/RuleEditor.tsx` | Rule editor primitive. |
| `cart/shitcoin/components/primitives/AuditLog.tsx` | Audit log primitive. |
| `cart/shitcoin/components/primitives/*.cls.ts` | Matching skin sheets for each primitive. |

---

## Dependencies and imports

### Entry (`index.tsx`)

```tsx
import { ThemeProvider } from '../../runtime/classifier';
import { APP_COLORS, APP_STYLES } from './theme';
import { Desktop } from './components';
import './ifttt_sim';   // side-effect: registers IFTTT sources/actions
import './achievements'; // side-effect: defines achievement set
```

### Sim layer (`sim.ts` / `sim_engine.ts`)

```ts
import { subscribe, emit } from '../../runtime/ffi';
import { readFile, writeFile } from '../../runtime/hooks/fs';
```

### Components

```tsx
import { Box, Text, Pressable, ScrollView, TextInput, Filter } from '@reactjit/runtime/primitives';
import { classifiers as C, classifier, ThemeProvider } from 'runtime/classifier';
import { Router, Route, useRoute, useNavigate } from 'runtime/router';
import { useIFTTT } from 'runtime/hooks/useIFTTT';
```

---

## Simulation architecture: Hot vs Cold

### Hot path (Zig, `framework/sim/*.zig`)

Runs at native frame rate:
- AMM price discovery (constant-product pools).
- NPC bot trading (~9 archetypes: retail, swing, whale, alpha, dev_insider, mev_bot, rug_runner, paper_hands, cartel).
- Player wallet (USD + token holdings).
- Trade tape (every AMM swap).
- Price patterns: crab, pump, dump, organic_up, organic_down, volatile, rug.
- Rug-pull logic.

### Cold path (`sim_engine.ts`)

Ticked at ~1 Hz:
- **Staking pools** — 7 recipes (USDT Saver, Syrup Pool, DEGEN Farm, SHIT Solo, etc.). APR, lock duration, vested caps.
- **Upgrades / hardware** — 40+ shop items; 8 hardware slots (monitor, cpu, ram, network, sound, gpu, keyboard, webcam). Purchased with USDT.
- **Mining rigs** — Cap 8. Tiered hash rate, power cost, wear. Mint tokens into player wallet via Zig.
- **LP positions** — Cap 16. Track share of pool; fees drained from Zig.
- **Pump favors** — NPC-granted pump/dump windows with backstab chance.
- **Reputation** — Score 0..1 per wallet.
- **Token websites** — Procedurally generated per token (scam factor, honeypot flag, whitepaper kind, mascot).
- **Ad slots** — 8 placements.
- **CEXes** — 5 exchanges (Coinbase, Binance, Kraken, KuCoin, Bybit) with KYC tiers, fees, listed tokens. Player balance stubs exist but CEX actions are unimplemented.
- **Social feed** — 4096-entry ring; whale-watch auto-posts when NPCs trade >$5k.
- **Telegram channels** — 32 channels; invite-only VIP groups; signal quality per admin.
- **Forum boards** — 20 boards across 5 forum sites.
- **News** — 256-entry ring; 8 news kinds.
- **Alpha leaks** — 64-entry ring; correct/fake insider tips.

### Facade (`sim.ts`)

A single `drainFrame()` loop (30 Hz notification cap) that:
1. Drains up to 64 AMM tape events per frame from Zig (`__zig_call('sim', 'drain_tape')`).
2. Every 6 frames (~5 Hz): pulls price snapshots.
3. Every 30 frames (~1 Hz): pulls market, time, wallet, holdings, staking snapshots; runs `engine.tickCold()`.
4. Notifies listener sets: generic, token-specific, market, wallet, trade, staking.

**Hooks** are thin wrappers:
```ts
export function useWallet(): Wallet | null {
  useSub(_walletListeners);
  return _wallet;
}
```
`useSub()` starts the rAF loop on first mount and subscribes to a listener set.

---

## Host bridge (`__zig_call`)

The sim talks to Zig exclusively through one host function:

```ts
function zigCall(fn: string, ...args: any[]): any {
  const host = globalThis as any;
  if (typeof host.__zig_call !== 'function') return null;
  return host.__zig_call('sim', fn, ...args);
}
```

**Zig functions called (complete list):**

| Function | Purpose |
|----------|---------|
| `current_price(id)` | Token spot price. |
| `token_count()` | Number of tokens. |
| `tick_count()` | Simulation tick counter. |
| `real_time_ms()` | In-sim real time. |
| `quote_buy(id, usd)` / `quote_sell(id, amt)` | AMM quote before slippage. |
| `buy(id, usd)` / `sell(id, amt)` | Execute trade; return output, impact, fee. |
| `reset()` | Wipe sim state. |
| `add_random_token()` | Spawn a new token. |
| `snapshot_run_id()` / `set_run_id(hi, lo)` | Run identity. |
| `snapshot_npcs(start, count)` | NPC wallet snapshots. |
| `snapshot_prices()` | All token price rows. |
| `snapshot_market()` | Global trend, vol, fear/greed. |
| `snapshot_time()` | Game time (day, hour). |
| `snapshot_wallet()` | Player USD + totals. |
| `snapshot_holdings()` | Player token holdings. |
| `drain_tape(max)` | AMM event tape rows. |
| `npc_count()` | NPC count. |
| `wallet_debit_usd(amount)` / `wallet_credit_usd(amount)` | Cold engine wallet ops. |
| `wallet_debit_holding(tokenId, amount)` / `wallet_credit_holding(...)` | Cold engine holding ops. |
| `apply_mining_yield(tokenId, minted, power)` | Mint mined tokens. |
| `pool_take_lp_fees(tokenId)` | Drain LP fees. |
| `apply_lp_add(tokenId, usdAmount)` | Add liquidity. |
| `apply_lp_remove(tokenId, base, quote, fees)` | Remove liquidity. |
| `set_token_pattern(tokenId, pattern)` | Force price pattern. |

**FFI bus events:**
- Subscribed: `sim:tokens`, `sim:player`, `sim:npcs:init`, `sim:trade:reset`, `sim:trade`, `sim:wallet`.
- Emitted: `sim:trade` (after every player trade, for IFTTT triggers).

---

## Component architecture

### OS shell

```
App
└── ThemeProvider
    └── Desktop
        ├── Icon Grid          (launches apps)
        ├── Window Manager     (absolute-positioned windows)
        │   └── Window
        │       └── AppView    (Browser, Telegram, SniperBot, etc.)
        ├── Start Menu
        ├── Taskbar
        └── AchievementsListener (invisible, mounts IFTTT bindings)
```

**Desktop** (`Desktop.tsx`) owns all window state: `windows[]`, z-order, focus, minimize, maximize (with `prevRect` snapshot/restore). Title-bar drag is implemented via framework pointer capture (`onMouseDown` records offset, `onMouseMove` updates state). Reads `useHardwareTier('monitor')` to decide CRT filter intensity — wraps the whole tree in `<Filter shader="crt">` when tier < 2.

**Window** (`Window.tsx`) is pure render. Receives `x, y, w, h, z, focused, maximized` and drag callbacks. Renders absolute-positioned chrome.

**Browser** (`Browser.tsx`) is a desktop app inside a Window. It owns a tab strip + per-tab `<Router local>`. All tabs stay mounted; inactive ones collapse to `height: 0, overflow: 'hidden'` so history survives tab switching. Memo-wrapped (`memo(BrowserImpl)`) so Desktop drag re-renders don't propagate.

### Apps

| App | Description |
|-----|-------------|
| **Browser** | Tab manager + local router. Has `/dev` route with reference docs. |
| **Telegram** | Channel list + message pane. Uses `useTGChannels()`. |
| **SniperBot** | `<ScriptApp>` wrapper with sniper trigger/action templates. |
| **ArbBot** | `<ScriptApp>` wrapper with CEX↔DEX arb templates. |
| **MiningRig** | Rig list + debug install buttons. Uses `useMiningRigs()`. |
| **ScriptApp** | Generic IFTTT rule editor. Owns `useScriptRules(appId)`, add/update/remove rules, per-rule `<RuleRunner>` mounting `useIFTTT`. |

---

## Classifier / theme system

### Theme tokens (`theme.ts`)

`APP_COLORS` and `APP_STYLES` are partial palettes injected at root via `<ThemeProvider>`.

**Color tokens:** `bg`, `bgAlt`, `bgElevated`, `surface`, `surfaceHover`, `border`, `borderFocus`, `text`, `textSecondary`, `textDim`, `primary`, `primaryHover`, `primaryPressed`, `accent`, `success`, `warning`, `error`, `info`.

**Style tokens:** `radiusSm`, `radiusMd`, `radiusLg`, `spacingSm`, `spacingMd`, `spacingLg`, `borderThin`, `borderMedium`, `fontSm`, `fontMd`, `fontLg`.

### Classifier definitions (`.cls.ts` files)

Every visual component has a `.tsx` logic file + a `.cls.ts` skin sheet.

```ts
// DexCard.cls.ts
classifier({
  DexCardRoot: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 12, backgroundColor: 'theme:surface' },
    variants: {
      uniswap: { style: { width: 410, padding: 22 } },
      pancake: { style: { width: 380, padding: 18 } },
    },
  },
});
```

Components import `classifiers as C` and render `<C.DexCardRoot>`. The active variant is chosen globally. Styles reference theme tokens (`theme:surface`) which are resolved at render time.

**Variant families:**
- DEX: `uniswap`, `pancake`, `sushi`, `dextools`, `etherscan`
- Wallet: `metamask`, `phantom`, `rabby`
- OS: `xp`, `win7`, `macos`, `linux`
- Browser: `chrome`, `brave`, `firefox`

### Skin system (`skins.ts`, `SkinProvider.tsx`)

A `Skin` is `{ variant, colors, styles }`. `applySkin(key)` calls `setVariant()` + `setTokens()` + `setStyleTokens()` to switch the entire UI appearance. `SkinProvider` wraps a subtree and applies a skin on mount.

**Caveat:** `setVariant`/`setTokens` write into a **global** store, so concurrent skins across tabs/windows are a known limitation.

---

## IFTTT integration (`ifttt_sim.ts`)

Side-effect module imported in `index.tsx`. Bridges the sim to the global IFTTT registry.

### Trigger sources

| Spec | Fires on |
|------|----------|
| `sim:trade:executed:buy[:<token_id>]` | Player buy (optional token filter). |
| `sim:trade:executed:sell[:<token_id>]` | Player sell (optional token filter). |
| `sim:trade:executed` | Any player trade. |
| `sim:trade:reset` | Run reset. |
| `sim:wallet:milestone:<usd>` | Wallet total crosses threshold upward (edge-detected). |
| `sim:wallet:bankrupted` | Wallet total ≤ $10. |
| `ach:<id>` | Synthetic achievement event. |

### Action verbs

| Spec | Effect |
|------|--------|
| `trade:buy:<id>:<usd>` | `sim.buy(id, usd)` |
| `trade:sell:<id>:<amount>` | `sim.sell(id, amt)` |
| `stake:harvest:<poolId>` | `sim.harvest(poolId)` |
| `stake:stake:<poolId>:<amount>` | `sim.stake(poolId, amount)` |
| `stake:unstake:<poolId>:<amount>` | `sim.unstake(poolId, amount)` |
| `ach:emit:<id>` | Broadcasts to `ach:<id>` listeners |
| `notify:<text>` | Toast notification |

---

## Achievements (`achievements.ts`)

**IDs:** `FirstTrade` (1), `100Trades` (2), `FirstHarvest` (3), `Millionaire` (4), `DiamondHands` (5), `Bankrupt` (6), `PaperHands` (7), `FirstBotBuy` (8).

**Persistence:** `./shitcoin_achievements.json`, keyed by player wallet address (from `sim:player` FFI event). Uses `readFile`/`writeFile` from `runtime/hooks/fs.ts`.

**API:** `setActivePlayer(addr)`, `progress(id, delta)`, `unlock(id)`, `isUnlocked(id)`, `getProgress(id)`, `onUnlock(fn)`.

Achievements survive `sim.reset()` — they are forever progression, not per-run.

**Steam adapter:** `adapters/steam.ts` is a stub that maps achievement IDs to Steam keys. `initSteamAdapter()` returns an `onUnlock` subscription (currently no-op until Steamworks is linked).

---

## Script rules (`useScriptRules.ts`)

**Type:** `ScriptRule = { id, label, enabled, triggerSpec, actionSpec, args, recentFires }`.

**Persistence:** `./shitcoin_scripts.json`, keyed by `(playerAddress → appId)`. Uses `readFile`/`writeFile`.

**API:** `setActivePlayer(addr)`, `getRules(appId)`, `addRule(appId, partial)`, `updateRule(appId, id, patch)`, `removeRule(appId, id)`, `recordFire(appId, id, realMs)`, `useScriptRules(appId)`.

**Template helper:** `resolveSpec(spec, args)` substitutes `$name` placeholders in trigger/action specs against `args`.

---

## Host functions used

| Host fn | Wrapper | Purpose |
|---------|---------|---------|
| `__zig_call` | `zigCall(fn, ...args)` | Exclusive bridge to Zig sim. Called hundreds of times per second. |
| `__fs_read` | `readFile(path)` | Load achievements and script rules JSON. |
| `__fs_write` | `writeFile(path, content)` | Save achievements and script rules JSON. |
| `subscribe` / `emit` | `runtime/ffi` | Event bus for `sim:trade`, `sim:wallet`, `sim:player`, etc. |

**No other host functions:** No `__http_*`, `__store_*`, `__exec`, `__clipboard`, `__crypto`, `__mermaidRender`, `__openWindow`, `__registerDispatch`.

---

## Glossary of concepts present in this cart

| Term | Meaning in this cart |
|------|----------------------|
| **Hot path** | Zig-native AMM simulation running at frame rate: prices, NPC trades, player wallet, tape. |
| **Cold path** | TypeScript meta-systems ticked at ~1 Hz: staking, mining, LP, social, news, CEX. |
| **sim.ts facade** | The unified API and React hook layer that hides the hot/cold split. |
| **Drain frame** | The rAF loop in `sim.ts` that pulls tape events, snapshots, and cold ticks from Zig. |
| **Listener sets** | Module-level `Set<()=>void>` per concern (wallet, market, trade, staking). Hooks subscribe; drain frame notifies. |
| **OS shell** | The Desktop component: wallpaper, icon grid, window manager, taskbar, start menu. |
| **Local router** | Each browser tab mounts its own `<Router local>` with independent back/forward history. |
| **Classifier** | The `classifier()` / `classifiers as C` pattern: register named UI factories with variant branches and theme-token styles. |
| **Theme token** | A string like `theme:surface` resolved at render time from the active color/style palette. |
| **Skin** | A preset bundle of `{ variant, colors, styles }` that switches the entire UI appearance. |
| **IFTTT rule** | A `{ triggerSpec, actionSpec }` pair registered globally. Triggers subscribe to bus events; actions call sim methods. |
| **Script rule** | A persisted IFTTT rule per `(player, app)` with an audit log (`recentFires`). |
| **Whale watch** | Auto-generated social post when an NPC trades >$5k on the AMM. |
| **Achievement** | Cross-run progression milestone (e.g. 100 trades, $1M net worth). File-persisted per player address. |
| **CRT filter** | A `<Filter shader="crt">` applied to the whole desktop when monitor hardware tier < 2. |
| **Hardware tier** | One of 8 slots (monitor, cpu, ram, etc.) with tiered upgrades that affect UI or sim bonuses. |

---

## What this cart does NOT do

- **No network / HTTP** — all data is procedural or from the Zig sim. No real market data.
- **No real blockchain** — wallet addresses are OS CSPRNG-generated; tokens are simulated AMM pools.
- **No CEX trading** — CEX balances and actions are stubbed/unimplemented.
- **No real Steam integration** — the Steam adapter is a stub.
- **No `localStorage`** — persistence uses `__fs_read`/`__fs_write` to JSON files, not browser storage.
- **No DOM APIs** — except `globalThis.addEventListener('keydown', ...)` for a dev hotkey (Ctrl+Shift+C toggles monitor tier).
