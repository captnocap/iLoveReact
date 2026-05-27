// IconButton — 1:1 square button with an SDF icon + a distinct bg color.
//
// Built for the /canvas bag, the composer toolbar, and any other strip
// that puts many small action tiles on screen. Bg color is deterministic
// per `name` (hash → pastel HSL) so each tile reads as its own thing
// without anyone having to hand-pick palettes. An explicit `bg` prop
// overrides; `active` re-skins to the theme accent.
//
// Renders the icon through <Icon name=...>, which routes to SdfIcon when
// the name is in BAKED_ICON_NAMES — those quads batch into one draw call.
// Names not in the atlas fall through to <Graph.Path> (Icon.tsx handles
// the routing). Pass `iconData` instead of `name` to bypass SDF entirely.

import { Box, Pressable } from '../primitives';
import { Icon, type IconData, type IconName } from './Icon';

export type IconButtonProps = {
  name?: IconName;
  iconData?: IconData;
  /** Square edge length in px. Default 36. */
  size?: number;
  /** Override the auto-derived background. Pass `'transparent'` for none. */
  bg?: string;
  /** Active state — swap to accent border + ink color. */
  active?: boolean;
  /** Icon stroke color. Defaults to a contrast pick over the bg. */
  iconColor?: string;
  /** Inner icon size. Defaults to ~50% of `size`. */
  iconSize?: number;
  /** Tooltip text shown on hover. Auto-positioned by framework/tooltip.zig. */
  tooltip?: string;
  onPress?: () => void;
  /** Mouse-down callback. Fires before onPress; used for drag-start
   *  gestures (alt+drag from the bag, etc.). */
  onMouseDown?: () => void;
};

// Stable string hash → 0..1.
function hash01(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return (h >>> 0) / 0xffffffff;
}

// HSL → hex. The runtime's color parser only understands `#rrggbb`,
// so we resolve HSL in JS and emit a hex literal. h ∈ [0, 360), s/l
// ∈ [0, 1].
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp < 1)      { r1 = c; g1 = x; b1 = 0; }
  else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
  else             { r1 = c; g1 = 0; b1 = x; }
  const m = l - c / 2;
  const r = Math.round(Math.max(0, Math.min(1, r1 + m)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, g1 + m)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, b1 + m)) * 255);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Distinct pastel-ish background derived from a stable key.
 *  Hue swept across the wheel, sat/lightness held in a narrow band so
 *  every tile reads as its own color but the rail stays visually quiet.
 *  Returns a hex string — the runtime's color parser only takes hex. */
export function colorForKey(key: string, opts?: { sat?: number; light?: number }): string {
  const sat = (opts?.sat ?? 38) / 100;
  const light = (opts?.light ?? 28) / 100;
  const hue = Math.floor(hash01(key) * 360);
  return hslToHex(hue, sat, light);
}

export function IconButton({
  name, iconData, size = 36, bg, active = false, iconColor, iconSize, tooltip, onPress, onMouseDown,
}: IconButtonProps) {
  const key = name ?? 'icon';
  const resolvedBg = bg ?? (active ? 'theme:bg2' : colorForKey(key));
  const resolvedIcon = iconColor ?? (active ? 'theme:accent' : 'theme:ink');
  const resolvedIconSize = iconSize ?? Math.max(10, Math.floor(size * 0.5));
  return (
    <Pressable onPress={onPress} onMouseDown={onMouseDown} tooltip={tooltip} style={{
      width: size,
      height: size,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: active ? 'theme:accent' : 'theme:rule',
      backgroundColor: resolvedBg,
    }}>
      {name || iconData ? (
        <Icon name={name} icon={iconData} size={resolvedIconSize} color={resolvedIcon} strokeWidth={2} />
      ) : (
        <Box style={{ width: resolvedIconSize, height: resolvedIconSize }} />
      )}
    </Pressable>
  );
}
