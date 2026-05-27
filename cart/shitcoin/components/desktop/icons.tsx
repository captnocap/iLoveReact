// Desktop app registry. Each app declares launcher metadata + the
// component rendered inside its Window.
//
// Icon path: `iconMatrix` (a PixelMatrix from cart/pixel_icons) wins;
// fallback to `glyph` string if no matrix is set. The matrix renders
// via <ShaderPixelIcon> — one WGSL quad per icon at any scale, with
// palette-swap animation effectively free.
//
// Two layers:
//   - BASE_APPS — present in every run (Browser).
//   - GATED_APPS — present only if the player has bought the matching
//     `app_*` Upgrade kind. `useDesktopApps()` joins the two.

import type { ComponentType } from 'react';
import type { PixelMatrix } from '../../../pixel_icons/PixelIcon';
import { pixelMatrixFromSeed, seedFromString } from '../../../pixel_icons/pixelMatrixFromSeed';
import { Browser } from '../browser/Browser';
import { Telegram } from './apps/Telegram';
import { SniperBot } from './apps/SniperBot';
import { ArbBot } from './apps/ArbBot';
import { MiningRig } from './apps/MiningRig';
import { useUpgrades } from '../../sim';

export type DesktopApp = {
  id: string;
  label: string;
  /** Procedural pixel icon. Preferred render path. */
  iconMatrix?: PixelMatrix;
  /** Fallback emoji glyph. Used only if iconMatrix is absent. */
  glyph?: string;
  defaultW: number;
  defaultH: number;
  defaultX: number;
  defaultY: number;
  render: ComponentType<any>;
  /** When set, the app only appears in the launcher if an Upgrade with
   *  this `kindName` has been purchased. Undefined = always shown. */
  requiresUpgradeKind?: string;
};

function iconFor(seed: string, hue: number): PixelMatrix {
  return pixelMatrixFromSeed(seedFromString(seed), {
    size: 16,
    paletteSize: 4,
    baseHue: hue,
    fillRate: 0.6,
    mirror: 'lr',
  });
}

const BROWSER_ICON   = iconFor('app:browser',   210);
const TELEGRAM_ICON  = iconFor('app:telegram',  200);
const SNIPER_ICON    = iconFor('app:sniper',    0);
const ARB_ICON       = iconFor('app:arb',       150);
const MINING_ICON    = iconFor('app:mining',    40);

const BASE_APPS: DesktopApp[] = [
  {
    id: 'browser',
    label: 'Browser',
    iconMatrix: BROWSER_ICON,
    defaultW: 1000, defaultH: 640,
    defaultX: 120, defaultY: 60,
    render: Browser,
  },
];

const GATED_APPS: DesktopApp[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    iconMatrix: TELEGRAM_ICON,
    defaultW: 820, defaultH: 560,
    defaultX: 160, defaultY: 80,
    render: Telegram,
    requiresUpgradeKind: 'app_telegram',
  },
  {
    id: 'sniper',
    label: 'Sniper Bot',
    iconMatrix: SNIPER_ICON,
    defaultW: 700, defaultH: 500,
    defaultX: 200, defaultY: 100,
    render: SniperBot,
    requiresUpgradeKind: 'app_sniper_bot',
  },
  {
    id: 'arb',
    label: 'Arb Bot',
    iconMatrix: ARB_ICON,
    defaultW: 700, defaultH: 500,
    defaultX: 240, defaultY: 120,
    render: ArbBot,
    requiresUpgradeKind: 'app_arb_bot',
  },
  {
    id: 'mining',
    label: 'Mining Rigs',
    iconMatrix: MINING_ICON,
    defaultW: 800, defaultH: 540,
    defaultX: 280, defaultY: 140,
    // Mining doesn't gate on a separate "app" upgrade — it gates on
    // owning at least one mining_rig upgrade. The Desktop hook
    // applies that rule.
    render: MiningRig,
    requiresUpgradeKind: 'mining_rig',
  },
];

/// All apps (gating ignored). Used by the start-menu "Apps" section
/// to enumerate everything the player COULD have, even unowned —
/// shown greyed-out so the player knows what to chase. Today the
/// menu just renders this list directly.
export const APPS: DesktopApp[] = [...BASE_APPS, ...GATED_APPS];

/// Resolve an app id to its descriptor, regardless of gating.
export function findApp(id: string): DesktopApp | undefined {
  return APPS.find((a) => a.id === id);
}

/// React hook: returns BASE_APPS + every GATED_APP whose
/// `requiresUpgradeKind` is in the player's owned/purchased upgrades.
/// This is what the Desktop icon grid + taskbar should read.
export function useDesktopApps(): DesktopApp[] {
  const upgrades = useUpgrades();
  const owned = new Set<string>();
  for (const u of upgrades) {
    if (u.purchased) owned.add(u.kindName);
  }
  return [
    ...BASE_APPS,
    ...GATED_APPS.filter((a) => !a.requiresUpgradeKind || owned.has(a.requiresUpgradeKind)),
  ];
}
