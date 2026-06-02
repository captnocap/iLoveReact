// studio.cls.ts — the shared classifier vocabulary for hmsc-int's 2D UI.
//
// Both load-bearing surfaces render through these classes:
//   • the in-focus PropertiesPanel  (per-instance inspector)
//   • the studio tab                 (tree · preview · properties · AI edit loop)
//
// Every value is a `theme:` token resolved from theme.ts — no raw colours here.
// Fixed pixel dims (knob/track sizes, rail width) are structural, not theme, so
// they stay literal. Per-INSTANCE state (toggle on/off, card status, active
// segment) can't ride the global variant axis, so it's expressed as sibling
// state classes (…On / …Active / Card<Status>) the component picks between.
//
//   import { C } from './studio.cls';
//   <C.Group><C.GroupHead>…</C.GroupHead></C.Group>
//
// Group accents (the per-category header colour) are passed per instance as a
// theme token, e.g. <C.GroupTitle color="theme:info">, so one class serves all.

import { classifier, classifiers as C } from '../../runtime/classifier';

const MONO = 'monospace';

classifier({
  // ─────────────────────────────────────────────────────────────
  // STRUCTURE
  // ─────────────────────────────────────────────────────────────
  StudioBg: { type: 'Box', style: { width: '100%', height: '100%', backgroundColor: 'theme:bg', flexDirection: 'column' } },
  StatusBar: {
    type: 'Box',
    style: {
      flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingSm',
      paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 6, paddingBottom: 6,
      backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border',
    },
  },
  StatusKicker: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 800, letterSpacing: 1.3 } },
  ColEdge: { type: 'Box', style: { borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:border' } },

  // hero / preview overlay header
  HeroBar: {
    type: 'Box',
    style: {
      flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingMd',
      paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 'theme:spacingMd', paddingBottom: 'theme:spacingMd',
      backgroundColor: 'theme:surface', borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:border',
    },
  },
  HeroName: { type: 'Text', fontSize: 'theme:fontHero', color: 'theme:text', fontWeight: 'bold' },
  HeroSub: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textDim', style: { fontFamily: MONO } },
  KindChip: {
    type: 'Box',
    style: { paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, backgroundColor: 'theme:primary' },
  },
  KindChipText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:bg', style: { fontFamily: MONO, fontWeight: 800, letterSpacing: 1.4 } },

  // ─────────────────────────────────────────────────────────────
  // GROUP (category block + header)
  // ─────────────────────────────────────────────────────────────
  Group: { type: 'Box', style: { borderBottomWidth: 'theme:borderThin', borderBottomColor: 'theme:borderSoft', paddingBottom: 'theme:spacingSm' } },
  GroupHead: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingSm', paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd', paddingTop: 9, paddingBottom: 5 } },
  GroupAccentBar: { type: 'Box', style: { width: 3, height: 11, backgroundColor: 'theme:primary' } }, // override color per group
  GroupTitle: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:primary', style: { fontFamily: MONO, fontWeight: 800, letterSpacing: 1.2 } }, // override color per group
  GroupRule: { type: 'Box', style: { flexGrow: 1, height: 1, backgroundColor: 'theme:borderSoft' } },
  GroupCount: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 700 } },

  // ─────────────────────────────────────────────────────────────
  // FIELD STRIP (the D1 flowing row of typed controls)
  // ─────────────────────────────────────────────────────────────
  FieldStrip: { type: 'Box', style: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 3, paddingLeft: 'theme:spacingMd', paddingRight: 'theme:spacingMd' } },
  Field: {
    type: 'Box',
    style: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      paddingLeft: 11, paddingRight: 11, paddingTop: 5, paddingBottom: 5,
      borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:track',
    },
  },
  FieldLabel: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 700 } },
  FieldValue: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:valText', style: { fontFamily: MONO, fontWeight: 600 } },
  FieldValueNum: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:valNum', style: { fontFamily: MONO, fontWeight: 700 } },

  // ─────────────────────────────────────────────────────────────
  // CONTROLS — boolean / scalar / number / enum / colour / material
  // ─────────────────────────────────────────────────────────────
  // toggle (boolean): Track + Knob; component swaps the …On siblings + knob x
  ToggleTrack:    { type: 'Box', style: { width: 22, height: 12, borderRadius: 7, backgroundColor: 'theme:offTrack' } },
  ToggleTrackOn:  { type: 'Box', style: { width: 22, height: 12, borderRadius: 7, backgroundColor: 'theme:onTrack' } },
  ToggleKnob:     { type: 'Box', style: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'theme:offKnob', position: 'absolute', top: 1, left: 1 } },
  ToggleKnobOn:   { type: 'Box', style: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'theme:success', position: 'absolute', top: 1, left: 11 } },

  // slider (0–1 scalar) — the fill IS the read
  SliderTrack: { type: 'Box', style: { width: 60, height: 6, borderRadius: 3, backgroundColor: 'theme:track', position: 'relative' } },
  SliderFill:  { type: 'Box', style: { height: 6, borderRadius: 3, backgroundColor: 'theme:primary', position: 'absolute', left: 0, top: 0 } },
  SliderKnob:  { type: 'Box', style: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'theme:knob', position: 'absolute', top: -2 } },
  SliderValue: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:valText', style: { fontFamily: MONO, fontWeight: 700, minWidth: 30, textAlign: 'right' } },

  // stepper (multiplier / cost / meters)
  Stepper:     { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' } },
  StepperBtn:  { type: 'Pressable', style: { width: 16, height: 18, alignItems: 'center', justifyContent: 'center' }, hoverStyle: { backgroundColor: 'theme:surfaceHover' } },
  StepperBtnText: { type: 'Text', fontSize: 'theme:fontXl', color: 'theme:textSecondary', style: { fontFamily: MONO, fontWeight: 700 } },
  StepperValue: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:valNum', style: { fontFamily: MONO, fontWeight: 700, minWidth: 36, textAlign: 'center', paddingLeft: 4, paddingRight: 4, borderLeftWidth: 'theme:borderThin', borderLeftColor: 'theme:controlBorder', borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:controlBorder' } },

  // segmented enum
  Segment:    { type: 'Box', style: { flexDirection: 'row', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', overflow: 'hidden' } },
  SegOption:  { type: 'Pressable', style: { paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:track' } },
  SegOptionActive: { type: 'Pressable', style: { paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:track', backgroundColor: 'theme:segActiveBg' } },
  SegText:        { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 700 } },
  SegTextActive:  { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:segActiveText', style: { fontFamily: MONO, fontWeight: 700 } },

  // colour well + material/texture swatch chip
  ColorSwatch: { type: 'Pressable', style: { width: 20, height: 20, borderRadius: 'theme:radiusSm', borderWidth: 'theme:borderThin', borderColor: 'theme:border' } }, // backgroundColor set per instance
  Chip:        { type: 'Pressable', style: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', backgroundColor: 'theme:controlBg' }, hoverStyle: { borderColor: 'theme:borderFocus' } },
  ChipSwatch:  { type: 'Box', style: { width: 15, height: 15, borderWidth: 'theme:borderThin', borderColor: 'theme:border' } }, // bg per instance
  ChipLabel:   { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:valText', style: { fontFamily: MONO, fontWeight: 600 } },

  // face-skin swatch (the muscle-memory layer)
  SkinSwatch:   { type: 'Pressable', style: { width: 22, height: 22, borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder' } },
  SkinSwatchOn: { type: 'Pressable', style: { width: 22, height: 22, borderWidth: 'theme:borderMedium', borderColor: 'theme:knob' } },
  SkinRoleLabel: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 700, letterSpacing: 0.5 } },

  // ─────────────────────────────────────────────────────────────
  // TREE
  // ─────────────────────────────────────────────────────────────
  Tree:        { type: 'Box', style: { width: '100%', height: '100%', backgroundColor: 'theme:bgAlt', borderRightWidth: 'theme:borderThin', borderRightColor: 'theme:border' } },
  TreeGroup:   { type: 'Pressable', style: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 7, paddingBottom: 4 } },
  TreeGroupText: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:textSecondary', style: { fontFamily: MONO, fontWeight: 800, letterSpacing: 0.6 } },
  TreeGroupCount: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 700 } },
  Leaf:        { type: 'Pressable', style: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 23, paddingLeft: 16, paddingRight: 8, borderLeftWidth: 'theme:borderMedium', borderLeftColor: 'transparent' }, hoverStyle: { backgroundColor: 'theme:surfaceHover' } },
  LeafActive:  { type: 'Pressable', style: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 23, paddingLeft: 16, paddingRight: 8, borderLeftWidth: 'theme:borderMedium', borderLeftColor: 'theme:primary', backgroundColor: 'theme:bgElevated' } },
  LeafSwatch:  { type: 'Box', style: { width: 11, height: 11, borderWidth: 'theme:borderThin', borderColor: 'theme:border' } },
  LeafText:    { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:textSecondary', style: { fontFamily: MONO, fontWeight: 600 } },
  LeafTextActive: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:text', style: { fontFamily: MONO, fontWeight: 700 } },
  LeafBadge:   { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 700 } },

  // ─────────────────────────────────────────────────────────────
  // AI EDIT LOOP — feed + change cards + prompt
  // ─────────────────────────────────────────────────────────────
  Feed: { type: 'Box', style: { width: '100%', height: '100%', backgroundColor: 'theme:bgAlt', flexDirection: 'column' } },
  // Card base = pending; the component picks the status sibling for the left accent.
  CardPending:  { type: 'Box', style: { backgroundColor: 'theme:cardBg', borderWidth: 'theme:borderThin', borderColor: 'theme:border', borderLeftWidth: 3, borderLeftColor: 'theme:textFaint', padding: 8 } },
  CardChild:    { type: 'Box', style: { backgroundColor: 'theme:cardBg', borderWidth: 'theme:borderThin', borderColor: 'theme:border', borderLeftWidth: 3, borderLeftColor: 'theme:primary', padding: 8 } },
  CardAccepted: { type: 'Box', style: { backgroundColor: 'theme:cardBg', borderWidth: 'theme:borderThin', borderColor: 'theme:border', borderLeftWidth: 3, borderLeftColor: 'theme:success', padding: 8, opacity: 0.85 } },
  CardRejected: { type: 'Box', style: { backgroundColor: 'theme:cardBg', borderWidth: 'theme:borderThin', borderColor: 'theme:border', borderLeftWidth: 3, borderLeftColor: 'theme:error', padding: 8, opacity: 0.6 } },
  CardOrphaned: { type: 'Box', style: { backgroundColor: 'theme:cardBg', borderWidth: 'theme:borderThin', borderColor: 'theme:border', borderLeftWidth: 3, borderLeftColor: 'theme:warning', padding: 8, opacity: 0.55 } },
  CardHead:     { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingSm' } },
  CardFn:       { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:textSecondary', style: { fontFamily: MONO, fontWeight: 700 } },
  CardStatus:   { type: 'Box', style: { paddingLeft: 6, paddingRight: 6, paddingTop: 1, paddingBottom: 1, borderWidth: 'theme:borderThin', borderColor: 'theme:textFaint' } }, // border/text color set per status
  CardStatusText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 700 } },
  CardRow:      { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 } },
  CardSwatch:   { type: 'Box', style: { width: 18, height: 18, borderWidth: 'theme:borderThin', borderColor: 'theme:bgAlt' } },
  CardArrow:    { type: 'Text', fontSize: 'theme:fontXl', color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 700 } },
  CardLabel:    { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:valText' },
  CardRationale:{ type: 'Text', fontSize: 'theme:fontLg', color: 'theme:textDim', style: { marginTop: 7 } },
  CardActions:  { type: 'Box', style: { flexDirection: 'row', gap: 6, marginTop: 8 } },
  BtnAccept:    { type: 'Pressable', style: { paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, backgroundColor: 'theme:bg', borderWidth: 'theme:borderThin', borderColor: 'theme:success' } },
  BtnAcceptText:{ type: 'Text', fontSize: 'theme:fontMd', color: 'theme:success', style: { fontFamily: MONO, fontWeight: 700 } },
  BtnReject:    { type: 'Pressable', style: { paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, backgroundColor: 'theme:bg', borderWidth: 'theme:borderThin', borderColor: 'theme:error' } },
  BtnRejectText:{ type: 'Text', fontSize: 'theme:fontMd', color: 'theme:error', style: { fontFamily: MONO, fontWeight: 700 } },
  Streaming:    { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 600 } },

  Prompt:      { type: 'Box', style: { backgroundColor: 'theme:surface', borderTopWidth: 'theme:borderThin', borderTopColor: 'theme:border', padding: 9 } },
  PromptHelp:  { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textFaint', style: { fontFamily: MONO, fontWeight: 600, marginBottom: 6 } },
  PromptInput: { type: 'TextInput', style: { flexGrow: 1, backgroundColor: 'theme:bg', borderWidth: 'theme:borderThin', borderColor: 'theme:controlBorder', color: 'theme:text', paddingLeft: 8, paddingRight: 8, paddingTop: 7, paddingBottom: 7 } },
  PromptSend:  { type: 'Pressable', style: { paddingLeft: 12, paddingRight: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'theme:bg', borderWidth: 'theme:borderThin', borderColor: 'theme:primary' } },
  PromptSendText: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:primary', style: { fontFamily: MONO, fontWeight: 700 } },

  // ─────────────────────────────────────────────────────────────
  // RAIL (outer right-panel tab switcher)
  // ─────────────────────────────────────────────────────────────
  Rail:        { type: 'Box', style: { width: 44, height: '100%', backgroundColor: 'theme:bgAlt', alignItems: 'center', borderLeftWidth: 'theme:borderThin', borderLeftColor: 'theme:border' } },
  RailTab:     { type: 'Pressable', style: { width: '100%', paddingTop: 9, paddingBottom: 9, gap: 3, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 'theme:borderMedium', borderLeftColor: 'transparent' } },
  RailTabActive: { type: 'Pressable', style: { width: '100%', paddingTop: 9, paddingBottom: 9, gap: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: 'theme:bg', borderLeftWidth: 'theme:borderMedium', borderLeftColor: 'theme:primary' } },
  RailTabText:   { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:textDim', style: { fontFamily: MONO, fontWeight: 700, letterSpacing: 0.5 } },
  RailTabTextActive: { type: 'Text', fontSize: 'theme:fontXs', color: 'theme:text', style: { fontFamily: MONO, fontWeight: 700, letterSpacing: 0.5 } },

  // empty / focus-less state
  EmptyState: { type: 'Box', style: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 'theme:spacingSm', padding: 'theme:spacingLg' } },
  EmptyTitle: { type: 'Text', fontSize: 'theme:fontXl', color: 'theme:textDim', style: { fontWeight: 700, letterSpacing: 1 } },
  EmptyHint:  { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:textFaint', style: { fontFamily: MONO, textAlign: 'center' } },
});

export { C };
