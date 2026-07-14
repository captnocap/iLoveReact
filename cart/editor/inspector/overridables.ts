// inspector/overridables.ts — shared descriptor shape for stepped/toggle
// inspector controls. Piece-instance override controls were removed because the
// loader did not consume their authored values; globals still use this geometry.

export type OverridableCtl = 'num' | 'bool';

export type OverridableProp = {
  /** the key written into piece.overrides */
  path: string;
  label: string;
  ctl: OverridableCtl;
  /** section header the field sits under */
  group: string;
  /** editing baseline (the value the first edit departs from) */
  base: number | boolean;
  min?: number;
  max?: number;
  step?: number;
};
