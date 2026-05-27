// SkinProvider — atomically swaps classifier variant + theme tokens for
// its subtree. Site components mount this at the top of their layout so
// every reusable component inside picks up the dapp's look.
//
// Implementation note: `setVariant` + `setTokens` write into the global
// theme store (runtime/theme.tsx), so technically a sibling tree using
// the same components would see the same skin. In practice each open
// "window" mounts/unmounts its own SkinProvider on focus or navigation;
// concurrent skins across tabs are a future problem (would require
// per-subtree theme contexts in the runtime).

import { useEffect } from 'react';
import { setVariant, setTokens, setStyleTokens } from '../../../../runtime/classifier';
import { SKINS, type SkinKey } from './skins';

export function applySkin(key: SkinKey): void {
  const skin = SKINS[key];
  if (!skin) return;
  setVariant(skin.variant);
  if (skin.colors && Object.keys(skin.colors).length) setTokens(skin.colors);
  if (skin.styles && Object.keys(skin.styles).length) setStyleTokens(skin.styles);
}

export interface SkinProviderProps {
  skin: SkinKey;
  children: any;
}

export function SkinProvider({ skin, children }: SkinProviderProps) {
  useEffect(() => {
    applySkin(skin);
  }, [skin]);
  return children;
}

/** Imperative variant for places where you'd rather call from an
 *  event handler than mount a provider. */
export function useSkin(skin: SkinKey): void {
  useEffect(() => {
    applySkin(skin);
  }, [skin]);
}
