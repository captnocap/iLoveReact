// game/figure/shapes.ts — the figure kit's DATA layer (P2: every
// designer-tunable table lives here, exported, nothing buried in logic).
//
// Captured fresh from cart/head_lab/parts.ts (the V2 behavior reference).
// The decomposition is the user's: a head egg, a tall+wide torso barrel, ONE
// limb pipe placed eight times (upper/fore arms AND thighs/shins), and
// wide-but-flat blocks for hands and feet. Every part is the SAME sculptable
// Globe surface wearing a different silhouette profile, so the unwrap
// painter, the depth brush, the .hed layers, and the animation machinery
// work identically on all of them. Mirrored limbs reuse one part doc —
// sculpt the pipe once, both arms and both legs follow.

export type PartId = 'head' | 'torso' | 'pelvis' | 'pipe' | 'hand' | 'foot' | 'finger';
export const PART_IDS: PartId[] = ['head', 'torso', 'pelvis', 'pipe', 'hand', 'foot', 'finger'];
/** pre-finger documents validate against this subset (schema by addition;
 *  the pelvis part is likewise post-legacy — PELVISMESH-0606) */
export const LEGACY_PART_IDS: PartId[] = ['head', 'torso', 'pipe', 'hand', 'foot'];

// ── paint targets (MODELPAINT-0605 LIMBPAINT, the user's ruling) ─────────────
// "can we update it so we can say this is a left upper arm, lower arm, upper
// leg, lower leg, so we dont have some stupid shit" — GEOMETRY stays the
// shared-part model (one pipe sculpted once, every limb follows), but PAINT
// addresses individual limb segments. A paint target is either a part (the
// "all instances" surface — also the pre-LIMBPAINT vocabulary, so old
// documents keep meaning) or one limb segment; per-instance resolution is
// SEGMENT WINS, PART IS THE FALLBACK.

// PELVISMESH-0606: 'pelvis' is NO LONGER a limb segment — the user ruled the
// pelvis a REAL PART ("make the torso and the pelvis not the same mesh"), so
// the string 'pelvis' moved from LimbPaintTargetId into PartId. The PAINT
// vocabulary is unchanged at the string level (old documents' paint.pelvis
// keeps meaning — same unwrap dims, now sampled by the pelvis's own mesh).
export type LimbPaintTargetId =
  | 'lUpperArm' | 'rUpperArm' | 'lLowerArm' | 'rLowerArm'
  | 'lUpperLeg' | 'rUpperLeg' | 'lLowerLeg' | 'rLowerLeg'
  | 'lHand' | 'rHand' | 'lFoot' | 'rFoot';
export type PaintTargetId = PartId | LimbPaintTargetId;

export const LIMB_PAINT_TARGET_IDS: LimbPaintTargetId[] = [
  'lUpperArm', 'rUpperArm', 'lLowerArm', 'rLowerArm',
  'lUpperLeg', 'rUpperLeg', 'lLowerLeg', 'rLowerLeg',
  'lHand', 'rHand', 'lFoot', 'rFoot',
];
export const PAINT_TARGET_IDS: PaintTargetId[] = [...PART_IDS, ...LIMB_PAINT_TARGET_IDS];

/** what the paint rails call each target (the user's words lead) */
export const PAINT_TARGET_LABELS: Record<PaintTargetId, string> = {
  head: 'face', torso: 'torso', pipe: 'all limbs', hand: 'both hands', foot: 'both feet', finger: 'fingers',
  lUpperArm: 'L upper arm', rUpperArm: 'R upper arm',
  lLowerArm: 'L lower arm', rLowerArm: 'R lower arm',
  lUpperLeg: 'L upper leg', rUpperLeg: 'R upper leg',
  lLowerLeg: 'L lower leg', rLowerLeg: 'R lower leg',
  lHand: 'L hand', rHand: 'R hand', lFoot: 'L foot', rFoot: 'R foot',
  pelvis: 'pelvis',
};

/** which PART a segment paints (its unwrap space + preview geometry) */
export const PAINT_TARGET_PART: Record<LimbPaintTargetId, PartId> = {
  lUpperArm: 'pipe', rUpperArm: 'pipe', lLowerArm: 'pipe', rLowerArm: 'pipe',
  lUpperLeg: 'pipe', rUpperLeg: 'pipe', lLowerLeg: 'pipe', rLowerLeg: 'pipe',
  lHand: 'hand', rHand: 'hand', lFoot: 'foot', rFoot: 'foot',
};

export function paintTargetPart(target: PaintTargetId): PartId {
  return (PAINT_TARGET_PART as Record<string, PartId>)[target] ?? (target as PartId);
}

/** bone → limb segment (the skeleton's own vocabulary; wrists ride the
 *  lower arm — a forearm tattoo runs to the wrist) */
export const PAINT_TARGET_BY_BONE: Record<string, LimbPaintTargetId> = {
  lUpperArm: 'lUpperArm', rUpperArm: 'rUpperArm',
  lForearm: 'lLowerArm', rForearm: 'rLowerArm',
  lWrist: 'lLowerArm', rWrist: 'rLowerArm',
  lThigh: 'lUpperLeg', rThigh: 'rUpperLeg',
  lShin: 'lLowerLeg', rShin: 'rLowerLeg',
  lHand: 'lHand', rHand: 'rHand', lFoot: 'lFoot', rFoot: 'rFoot',
  // (no pelvis row — PELVISMESH-0606: the pelvis bone wears the pelvis PART;
  // paintTargetForInstance resolves it through the part path, not a segment)
};

/** Segments that must NEVER inherit their part's paint: limbs WANT the
 *  'all limbs' fallback. EMPTY since PELVISMESH-0606 — the pelvis (the one
 *  no-fallback segment, the "two sets of tits" fix) became a real part with
 *  its own mesh + unwrap, so torso paint can no longer cascade anywhere it
 *  shouldn't. The seam stays for any future no-fallback segment. */
export const PAINT_TARGET_NO_PART_FALLBACK: ReadonlySet<PaintTargetId> = new Set([]);

/** The paint target ONE INSTANCE resolves to: its bone's segment when the
 *  segment paints this part (anatomy blobs riding joint bones keep their
 *  plain part), else the part itself. */
export function paintTargetForInstance(part: PartId, bone?: string): PaintTargetId {
  const segment = bone ? PAINT_TARGET_BY_BONE[bone] : undefined;
  return segment && PAINT_TARGET_PART[segment] === part ? segment : part;
}

export type PartPreset = {
  label: string;
  /** silhouette: lerped radius multipliers along v (Globe.profile semantics —
   *  RADIAL ONLY: profiles thin x/z, never length; length is scaleY alone.
   *  Profile-scaled length was the detached-wrist bug. Do not restore it. */
  profile?: number[];
  scaleX?: number;
  /** the part's EFFECTIVE length (see the radial-only rule above) */
  scaleY: number;
  scaleZ?: number;
};

// ── the FOOT SHAPE dials (FOOTMESH-0606) ─────────────────────────────────────
// "sole length/width, heel height, toe-box lean/flatness are tuning data" —
// the user dials the look on the part's sculpt surface; these are the sane
// STARTING values, never final numbers. Plan-view toe taper stays the
// profile/grab-sculpt's job (the outline lathe + the 48×24 grid own radial
// shape; these dials own the axes the profile cannot reach).

export type FootShape = {
  /** heel-to-toe extent (Globe scaleZ — the depth axis) */
  soleLength: number;
  /** side-to-side extent (Globe scaleX) */
  soleWidth: number;
  /** ankle-to-sole height (Globe scaleY — the part's length axis) */
  heelHeight: number;
  /** toe-box forward lean: how far the sole rings shift toward the toes
   *  (front = -Z, the figure's facing) while the ankle stays back */
  toeLean: number;
  /** flat-cut fraction of the bottom dome (Globe floorY): the sole plane
   *  sits at -heelHeight·soleFlat; 1 = full dome (no cut) */
  soleFlat: number;
};

export const FOOT_SHAPE_DEFAULTS: FootShape = {
  soleLength: 1.45,
  soleWidth: 0.55,
  heelHeight: 0.62,
  toeLean: 0.55,
  soleFlat: 0.55,
};

/** Dial specs in the tunables/FieldSpec shape — the workbench panel
 *  generates its FOOT group straight from this table. */
export const FOOT_SHAPE_SPECS: Record<keyof FootShape, { label: string; min: number; max: number; step: number; precision: number }> = {
  soleLength: { label: 'sole length', min: 0.6, max: 2.6, step: 0.05, precision: 2 },
  soleWidth: { label: 'sole width', min: 0.25, max: 1.4, step: 0.05, precision: 2 },
  heelHeight: { label: 'heel height', min: 0.2, max: 1.2, step: 0.02, precision: 2 },
  toeLean: { label: 'toe box', min: 0, max: 1.2, step: 0.05, precision: 2 },
  soleFlat: { label: 'sole flat', min: 0.05, max: 1, step: 0.05, precision: 2 },
};

/** Boundary validation: clamp each dial into its spec range; anything
 *  non-finite (or a missing/foreign record) falls back to the default. */
export function validateFootShape(value: unknown): FootShape {
  const v = (value ?? {}) as Partial<Record<keyof FootShape, unknown>>;
  const out = {} as FootShape;
  for (const k of Object.keys(FOOT_SHAPE_SPECS) as Array<keyof FootShape>) {
    const spec = FOOT_SHAPE_SPECS[k];
    const n = Number(v[k]);
    out[k] = Number.isFinite(n) ? Math.max(spec.min, Math.min(spec.max, n)) : FOOT_SHAPE_DEFAULTS[k];
  }
  return out;
}

/** The ONE mapping from dials to Globe params (FOOTMESH-0606). The toe-box
 *  lean is a per-v ring-center shift: ankle rings sit back (+Z), sole rings
 *  push forward (-Z = the figure's facing) — the instep slope and the
 *  forward toe box fall out of the same curve. floorY flat-cuts the bottom
 *  dome onto the sole plane, so nothing ever spikes below the foot again. */
export function footShapeGlobeExtras(shape?: FootShape | null): {
  scaleX: number; scaleY: number; scaleZ: number; shiftZ: number[]; floorY: number;
} {
  const s = shape ?? FOOT_SHAPE_DEFAULTS;
  const t = s.toeLean;
  return {
    scaleX: s.soleWidth,
    scaleY: s.heelHeight,
    scaleZ: s.soleLength,
    shiftZ: [0.35 * t, 0.25 * t, 0.02 * t, -0.38 * t, -0.78 * t, -0.95 * t],
    floorY: s.soleFlat,
  };
}

export const PART_PRESETS: Record<PartId, PartPreset> = {
  head: { label: 'head', scaleY: 1.2 },
  // taller and wider than the egg: shoulders → chest → waist → hips
  torso: { label: 'torso', scaleY: 1.14, scaleZ: 0.62, profile: [0.72, 1.0, 0.94, 0.88, 0.6] },
  // PELVISMESH-0606: its own sculptable mesh ("make the torso and the pelvis
  // not the same mesh"). The DEFAULT silhouette is the torso preset verbatim —
  // the old pelvis socket wore the whole torso globe scaled down, so a fresh
  // pelvis looks exactly like it always did until the user sculpts it apart.
  pelvis: { label: 'pelvis', scaleY: 1.14, scaleZ: 0.62, profile: [0.72, 1.0, 0.94, 0.88, 0.6] },
  // the limb pipe: long and SLIM, slightly waisted, rounded ends so two of
  // them visually connect at an elbow/knee without a seam gap
  pipe: { label: 'pipe', scaleY: 1.37, scaleX: 0.42, scaleZ: 0.42, profile: [0.45, 0.85, 0.8, 0.85, 0.45] },
  // compact palm pad; fingers carry the readable hand length, not this blob
  hand: { label: 'hand', scaleX: 0.62, scaleY: 0.5, scaleZ: 0.42, profile: [0.5, 0.92, 0.76] },
  // FOOTMESH-0606 (USER, verbatim: "what the hell is this for a foot LMAO
  // please someone make a better foot this shit is comical"): the old foot
  // was a squashed lens the shin tip spiked straight through. The foot is a
  // REAL mesh part now — ankle→instep→sole profile, toe box leaning forward
  // (Globe shiftZ), flat sole on the ground plane (Globe floorY). The scale
  // numbers here are the FALLBACK silhouette only; the live values come from
  // FOOT_SHAPE dials on the document (footShapeGlobeExtras below).
  foot: { label: 'foot', scaleY: FOOT_SHAPE_DEFAULTS.heelHeight, scaleX: FOOT_SHAPE_DEFAULTS.soleWidth, scaleZ: FOOT_SHAPE_DEFAULTS.soleLength, profile: [0.38, 0.5, 0.66, 0.85, 1.0, 1.0] },
  // digits are tiny limb pipes with a less bulbous silhouette — still
  // paintable parts, so one finger sculpt fans across both hands
  finger: { label: 'finger', scaleY: 0.79, scaleX: 0.34, scaleZ: 0.28, profile: [0.54, 0.92, 0.8, 0.5] },
};

/** Editable outline resolution: a part silhouette is PROFILE_N radius samples
 *  top→bottom. The presets are DEFAULTS — resampled to this grid on init. */
export const PROFILE_N = 16;

export function defaultProfile(id: PartId): number[] {
  const src = PART_PRESETS[id].profile ?? [1];
  const out: number[] = [];
  for (let i = 0; i < PROFILE_N; i++) {
    if (src.length === 1) { out.push(src[0]); continue; }
    const t = (i / (PROFILE_N - 1)) * (src.length - 1);
    const j = Math.min(src.length - 2, Math.floor(t));
    out.push(src[j] + (src[j + 1] - src[j]) * (t - j));
  }
  return out;
}

// ── body shapes — "the variety of life is the right shape" (V2-AMENDED) ─────

export type BodyShapeId = 'neutral' | 'female' | 'male' | 'tall' | 'short' | 'heavy' | 'skinny' | 'bodybuilder';

export type BodyShape = {
  label: string;
  height: number;
  shoulder: number;
  hip: number;
  torsoWide: number;
  torsoLong: number;
  limbLong: number;
  limbThick: number;
  head: number;
  hand: number;
  foot: number;
  /** knee/foot x as a multiple of the hip joint x (default 1.08). Wide hips
   *  + a sub-1 stance = the femur angle: legs converge toward the knees. */
  stance?: number;
};

export const BODY_SHAPES: Record<BodyShapeId, BodyShape> = {
  neutral: { label: 'neutral', height: 1, shoulder: 1, hip: 1, torsoWide: 1, torsoLong: 1, limbLong: 1, limbThick: 1, head: 1, hand: 1, foot: 1 },
  female: { label: 'female', height: 0.98, shoulder: 0.9, hip: 1.16, torsoWide: 0.92, torsoLong: 1.02, limbLong: 1, limbThick: 0.92, head: 1.02, hand: 0.94, foot: 0.92, stance: 0.82 },
  male: { label: 'male', height: 1.03, shoulder: 1.18, hip: 0.98, torsoWide: 1.1, torsoLong: 1.03, limbLong: 1.02, limbThick: 1.12, head: 1, hand: 1.06, foot: 1.06 },
  tall: { label: 'tall', height: 1.16, shoulder: 1.04, hip: 1, torsoWide: 0.96, torsoLong: 1.08, limbLong: 1.18, limbThick: 0.94, head: 0.94, hand: 1, foot: 1.05 },
  short: { label: 'short', height: 0.86, shoulder: 1.03, hip: 1.04, torsoWide: 1.04, torsoLong: 0.92, limbLong: 0.84, limbThick: 1.04, head: 1.12, hand: 0.96, foot: 0.96 },
  heavy: { label: 'heavy', height: 0.98, shoulder: 1.2, hip: 1.22, torsoWide: 1.28, torsoLong: 1, limbLong: 0.96, limbThick: 1.22, head: 1.04, hand: 1.08, foot: 1.1 },
  skinny: { label: 'skinny', height: 1.04, shoulder: 0.88, hip: 0.88, torsoWide: 0.78, torsoLong: 1.04, limbLong: 1.06, limbThick: 0.72, head: 1.01, hand: 0.92, foot: 0.94 },
  bodybuilder: { label: 'builder', height: 1.05, shoulder: 1.34, hip: 1.02, torsoWide: 1.22, torsoLong: 1.02, limbLong: 1.02, limbThick: 1.42, head: 0.96, hand: 1.12, foot: 1.08 },
};

export type BodyPoseId = 'stand' | 'walk' | 'kneel' | 'flex' | 'wave';

export const BODY_POSES: Record<BodyPoseId, { label: string }> = {
  stand: { label: 'stand' },
  walk: { label: 'walk' },
  kneel: { label: 'kneel' },
  flex: { label: 'flex' },
  wave: { label: 'wave' },
};

// ── garments — the clothing data tables ──────────────────────────────────────

export type ClothingId = 'underwear' | 'tee' | 'hoodie' | 'dress' | 'armor' | 'suit';
export type BottomsId = 'briefs' | 'shorts' | 'jeans' | 'slacks' | 'skirt';
export type ClothingSkinId = 'plain' | 'designer' | 'stupid' | 'fourtwenty' | 'debug';
export type ClothingAccessoryId = 'shades' | 'cap' | 'beanie' | 'backpack';

export type GarmentPalette = { label: string; primary: string; secondary: string; accent: string };

export const CLOTHING: Record<ClothingId, GarmentPalette> = {
  underwear: { label: 'underwear', primary: '#e8e2d8', secondary: '#d7cfc4', accent: '#f2ede7' },
  tee: { label: 'tee', primary: '#3457d5', secondary: '#243b93', accent: '#f2f6ff' },
  hoodie: { label: 'hoodie', primary: '#334155', secondary: '#1f2937', accent: '#94a3b8' },
  dress: { label: 'dress', primary: '#b83280', secondary: '#7e245d', accent: '#f9a8d4' },
  armor: { label: 'armor', primary: '#64748b', secondary: '#334155', accent: '#cbd5e1' },
  suit: { label: 'suit', primary: '#171717', secondary: '#2f2f35', accent: '#f8fafc' },
};

/** `accent` is the cuff/hem trim (jeans' rolled cuff reads lighter). */
export const BOTTOMS: Record<BottomsId, GarmentPalette> = {
  briefs: { label: 'briefs', primary: '#e8e2d8', secondary: '#d7cfc4', accent: '#f2ede7' },
  shorts: { label: 'shorts', primary: '#8a7a5f', secondary: '#6e6049', accent: '#a4937a' },
  jeans: { label: 'jeans', primary: '#3a5a8c', secondary: '#2c4368', accent: '#7d97bd' },
  slacks: { label: 'slacks', primary: '#26262e', secondary: '#1b1b22', accent: '#3a3a46' },
  skirt: { label: 'skirt', primary: '#8c3358', secondary: '#6b2543', accent: '#a85a7c' },
};

/** Picking a top snaps bottoms to a coherent default; users override after. */
export const DEFAULT_BOTTOMS: Record<ClothingId, BottomsId> = {
  underwear: 'briefs',
  tee: 'jeans',
  hoodie: 'jeans',
  dress: 'briefs', // the dress IS the bottom — briefs stay hidden under it
  armor: 'slacks',
  suit: 'slacks',
};

export const CLOTHING_SKINS: Record<ClothingSkinId, { label: string }> = {
  plain: { label: 'plain' },
  designer: { label: 'designer' },
  stupid: { label: 'i am with stupid' },
  fourtwenty: { label: '4:20 somewhere' },
  debug: { label: 'debug tee' },
};

export const CLOTHING_ACCESSORIES: Record<ClothingAccessoryId, { label: string }> = {
  shades: { label: 'shades' },
  cap: { label: 'cap' },
  beanie: { label: 'beanie' },
  backpack: { label: 'backpack' },
};

export function clothingSkinTextureKey(skin: ClothingSkinId): string {
  return `headlab.clothing.${skin}`;
}

// ── game-distance render LODs (preview path; the bake reads them too) ────────

export const PART_LOD: Record<PartId, { segments: number; rings: number }> = {
  head: { segments: 40, rings: 20 },
  torso: { segments: 24, rings: 12 },
  // the pelvis renders smaller than the torso but sculpts the same unwrap —
  // same LOD so the 48×24 grid lands on real quads (PELVISMESH-0606)
  pelvis: { segments: 24, rings: 12 },
  pipe: { segments: 16, rings: 9 },
  hand: { segments: 16, rings: 8 },
  // FOOTMESH-0606: the toe box + flat-cut sole need rows to land on — the
  // old 14×8 lens rendered the lean as one smeared quad
  foot: { segments: 22, rings: 12 },
  finger: { segments: 10, rings: 7 },
};
