// Style helpers shared by the gallery builders. Keep these dumb — no logic,
// just shape sugar that reads better than the literal expansion at call sites.

import type { SpaceToken, FontToken } from './gallery-tokens';

/** Symmetric horizontal/vertical padding. */
export const padXY = (x: SpaceToken | number, y: SpaceToken | number) => ({
  paddingLeft: x, paddingRight: x,
  paddingTop: y, paddingBottom: y,
});

/** Mono font preset. Bare — caller decides whitespace handling. */
export const mono: { fontFamily: FontToken } = { fontFamily: 'theme:fontMono' };

/** Mono font + `pre` whitespace. The default for chrome strings. */
export const monoPre: { fontFamily: FontToken; whiteSpace: 'pre' } = {
  fontFamily: 'theme:fontMono', whiteSpace: 'pre',
};
