/**
 * Component-gallery classifier sheet.
 *
 * Single-primitive classifiers bound to cockpit theme tokens. Components
 * consume `<S.Foo>`; raw `<Box style={...}>` is forbidden in this cart
 * (gate enforces).
 *
 * Token namespace (set by cart/app/gallery/gallery-theme.ts → runtime):
 *
 *   Colors (strings):
 *     bg / bg1 / bg2                  surfaces
 *     paper / paperAlt / paperInk
 *     paperInkDim / paperRule
 *     paperRuleBright                 paper content tier
 *     ink / inkDim / inkDimmer        text
 *     inkGhost
 *     rule / ruleBright               borders
 *     accent / accentHot              accent
 *     ok / warn / flag                state signals
 *     lilac / blue                    auxiliary
 *     sys / ctx / usr / ast / atch    data channels
 *     tool / wnd / pin
 *     transparent
 *     gridDot / gridDotStrong         decorative
 *     fontMono / fontSans             font families (string)
 *
 *   Numbers (style palette):
 *     typeMicro(7) typeTiny(8) typeCaption(9) typeBody(10)
 *     typeBase(11) typeMeta(12) typeStrong(14) typeHeading(18)
 *     radiusSm(4) radiusMd(6) radiusLg(8) radiusXl(10) radiusPill(99) radiusRound(999)
 *     spaceX0(1) spaceX1(2) spaceX2(4) spaceX3(6) spaceX4(8) spaceX5(10)
 *     spaceX6(12) spaceX7(16) spaceX8(18)
 *     chromeTopbar(28) chromeStatusbar(22) chromeTileHead(20) chromeStrip(28)
 *     lineHeight(1.35)
 *
 * Authoring rules (load-bearing):
 *   • One classifier = one primitive. No children logic, no slots.
 *   • Compose by stacking <S.Foo><S.Bar/></S.Foo> in JSX.
 *   • All colors via 'theme:NAME'. No hex literals here.
 *   • Numeric style values via 'theme:NAME' where the token exists.
 *   • Existing structural names (TypeMicro, InlineX*, StackX*, BareGraph,
 *     Spacer, HalfPress, DotSm, DotMd, RoundPill, ChipRound) are preserved
 *     by name — many components already consume them. Their values were
 *     token-ified in place.
 */

import { classifier } from '@reactjit/core';

// Natural height of the app's bottom input bar. Used by the
// AppBottomInputBar classifier (its explicit height) and re-exported so
// cart/app can match its routes paddingBottom to it without owning a
// duplicate fallback constant. Single source of truth: change once here
// and both the slot and the page reflow stay in sync.
export const APP_BOTTOM_BAR_H = 166;

classifier({

  // ══════════════════════════════════════════════════════════════
  //   Page shell + chrome
  // ══════════════════════════════════════════════════════════════

  // Full-viewport container.
  Page: { type: 'Box', style: {
    width: '100%', height: '100%',
    backgroundColor: 'theme:bg',
  }, variants: {
    light: { style: { backgroundColor: 'theme:paper' } },
    dark: { style: { backgroundColor: 'theme:bg' } },
  }},

  // Pinned top: icon + title + badge + spacer + subtitle.
  StoryHeader: { type: 'Box', style: { flexDirection: 'row',
    flexShrink: 0,
    backgroundColor: 'theme:bg1',
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    paddingTop: 'theme:spaceX6', paddingBottom: 'theme:spaceX6',
    gap: 'theme:spaceX7',
  }, variants: {
    light: { style: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      backgroundColor: 'theme:paper',
      borderBottomWidth: 2,
      borderColor: 'theme:paperRule',
      gap: 'theme:spaceX3',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg2',
      borderBottomWidth: 2,
      borderColor: 'theme:accentHot',
      paddingTop: 'theme:spaceX4',
      paddingBottom: 'theme:spaceX4',
      gap: 'theme:spaceX5',
    } },
  }},

  // Pinned bottom: breadcrumb path.
  StoryFooter: { type: 'Box', style: { flexDirection: 'row',
    flexShrink: 0,
    backgroundColor: 'theme:bg1',
    borderTopWidth: 1,
    borderColor: 'theme:rule',
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
    gap: 'theme:spaceX6',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paperAlt',
      borderTopWidth: 2,
      borderColor: 'theme:paperRule',
      paddingTop: 'theme:spaceX4',
      paddingBottom: 'theme:spaceX4',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg2',
      borderTopWidth: 2,
      borderColor: 'theme:ruleBright',
      paddingTop: 'theme:spaceX2',
      paddingBottom: 'theme:spaceX2',
    } },
  }},

  // Standard gallery display wrapper. This is the target chrome for examples
  // that need normalized viewport, scale, and identification.
  GalleryDisplayFrame: { type: 'Box', style: {
    flexDirection: 'column',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'theme:ruleBright',
    borderRadius: 'theme:radiusMd',
    backgroundColor: 'theme:bg',
    overflow: 'hidden',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRule',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg',
      borderColor: 'theme:accentHot',
    } },
  }},
  GalleryDisplayTopBar: { type: 'Box', style: { flexDirection: 'row',
    height: 22,
    flexShrink: 0,
    alignItems: 'center',
    gap: 'theme:spaceX4',
    paddingLeft: 'theme:spaceX4',
    paddingRight: 'theme:spaceX4',
    backgroundColor: 'theme:bg1',
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
  }},
  GalleryDisplayCode: { type: 'Text', size: 'theme:typeCaption', bold: true,
    color: 'theme:accentHot',
    numberOfLines: 1,
    style: { fontFamily: 'theme:fontMono', letterSpacing: 1.2 },
  },
  GalleryDisplayTitle: { type: 'Text', size: 'theme:typeBody', bold: true,
    color: 'theme:ink',
    numberOfLines: 1,
  },
  GalleryDisplayMeta: { type: 'Text', size: 'theme:typeTiny',
    color: 'theme:inkDimmer',
    numberOfLines: 1,
    style: { fontFamily: 'theme:fontMono', letterSpacing: 0.8 },
  },
  GalleryDisplayFooter: { type: 'Box', style: { flexDirection: 'row',
    height: 18,
    flexShrink: 0,
    alignItems: 'center',
    gap: 'theme:spaceX3',
    paddingLeft: 'theme:spaceX4',
    paddingRight: 'theme:spaceX4',
    backgroundColor: 'theme:bg1',
    borderTopWidth: 1,
    borderColor: 'theme:rule',
  }},
  GalleryDisplayBarcode: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'stretch',
    height: 12,
    gap: 1,
  }},
  GalleryDisplayBarcodeBar: { type: 'Box', style: {
    width: 1,
    height: 12,
    backgroundColor: 'theme:inkDim',
  }},
  GalleryDisplayBarcodeHot: { type: 'Box', style: {
    width: 2,
    height: 12,
    backgroundColor: 'theme:accentHot',
  }},
  GalleryDisplayStage: { type: 'Box', style: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'theme:bg2',
  }},
  GalleryDisplayBody: { type: 'Box', style: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  }},
  GalleryDisplayCenter: { type: 'Box', style: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 0,
  }},

  // ══════════════════════════════════════════════════════════════
  //   Bands (story content rows)
  // ══════════════════════════════════════════════════════════════

  // Accent left-border, full-width hero intro.
  Hero: { type: 'Box', style: {
    borderLeftWidth: 3,
    borderColor: 'theme:accent',
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    paddingTop: 'theme:spaceX7', paddingBottom: 'theme:spaceX7',
    gap: 'theme:spaceX4',
  }, variants: {
    light: { style: {
      borderLeftWidth: 0,
      borderTopWidth: 4,
      backgroundColor: 'theme:paperAlt',
      borderColor: 'theme:accent',
      borderRadius: 'theme:radiusXl',
    } },
    dark: { style: {
      borderLeftWidth: 6,
      backgroundColor: 'theme:bg2',
      borderColor: 'theme:accentHot',
      paddingTop: 'theme:spaceX5',
      paddingBottom: 'theme:spaceX5',
    } },
  }},

  // Two-column band (zigzag layout row).
  Band: { type: 'Box', style: { flexDirection: 'row',
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    paddingTop: 'theme:spaceX7', paddingBottom: 'theme:spaceX7',
    gap: 'theme:spaceX7',
  }, variants: {
    light: { style: {
      flexDirection: 'column',
      backgroundColor: 'theme:paper',
      borderRadius: 'theme:radiusXl',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
    } },
    dark: { style: {
      flexDirection: 'row',
      gap: 'theme:spaceX5',
      paddingTop: 'theme:spaceX5',
      paddingBottom: 'theme:spaceX5',
    } },
  }},

  // One side of a Band (50/50 split).
  Half: { type: 'Box', style: {
    flexGrow: 1, flexBasis: 0,
    gap: 'theme:spaceX4',
  }},

  HalfCenter: { type: 'Box', style: {
    flexGrow: 1, flexBasis: 0,
    gap: 'theme:spaceX4',
    alignItems: 'center', justifyContent: 'center',
  }},

  // Full-width band (no split).
  FullBand: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    paddingTop: 'theme:spaceX7', paddingBottom: 'theme:spaceX7',
    gap: 'theme:spaceX4',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paper',
      borderRadius: 'theme:radiusXl',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      gap: 'theme:spaceX6',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg1',
      borderWidth: 1,
      borderColor: 'theme:rule',
      borderRadius: 'theme:radiusSm',
      gap: 'theme:spaceX3',
    } },
  }},

  // Highlighted insight strip.
  Callout: { type: 'Box', style: { flexDirection: 'row',
    backgroundColor: 'theme:bg1',
    borderLeftWidth: 3,
    borderColor: 'theme:blue',
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    paddingTop: 'theme:spaceX6', paddingBottom: 'theme:spaceX6',
    gap: 'theme:spaceX4',
    alignItems: 'center',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paperAlt',
      borderLeftWidth: 0,
      borderWidth: 1,
      borderColor: 'theme:blue',
      borderRadius: 'theme:radiusLg',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg2',
      borderLeftWidth: 4,
      borderColor: 'theme:blue',
      borderRadius: 'theme:radiusSm',
    } },
  }},

  // Warning band.
  Warn: { type: 'Box', style: { flexDirection: 'row',
    backgroundColor: 'theme:bg1',
    borderLeftWidth: 3,
    borderColor: 'theme:warn',
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    paddingTop: 'theme:spaceX6', paddingBottom: 'theme:spaceX6',
    gap: 'theme:spaceX4',
    alignItems: 'center',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paperAlt',
      borderLeftWidth: 0,
      borderWidth: 1,
      borderColor: 'theme:warn',
      borderRadius: 'theme:radiusLg',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg2',
      borderLeftWidth: 4,
      borderColor: 'theme:warn',
      borderRadius: 'theme:radiusSm',
    } },
  }},

  // Horizontal divider.
  Divider: { type: 'Box', style: {
    height: 1, flexShrink: 0,
    backgroundColor: 'theme:rule',
  }},

  // Vertical divider.
  VertDivider: { type: 'Box', style: {
    width: 1, flexShrink: 0,
    backgroundColor: 'theme:rule',
  }},

  // ══════════════════════════════════════════════════════════════
  //   Surfaces (cards, wells, etc.)
  // ══════════════════════════════════════════════════════════════

  // Padded card surface w/ radius+gap. Compose with CardHeader/CardBody.
  Card: { type: 'Box', style: {
    flexDirection: 'column',
    padding: 'theme:spaceX7',
    backgroundColor: 'theme:bg1',
    borderRadius: 'theme:radiusLg',
    gap: 'theme:spaceX4',
  }, variants: {
    light: { style: {
      padding: 'theme:spaceX8',
      backgroundColor: 'theme:paper',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusXl',
      gap: 'theme:spaceX5',
    } },
    dark: { style: {
      padding: 'theme:spaceX5',
      backgroundColor: 'theme:bg2',
      borderWidth: 1,
      borderColor: 'theme:ruleBright',
      borderRadius: 'theme:radiusSm',
      gap: 'theme:spaceX3',
    } },
  }},

  // Card header row: title + spacer + badge.
  CardHeader: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    gap: 'theme:spaceX4',
  }},

  // Card body column.
  CardBody: { type: 'Box', style: {
    gap: 'theme:spaceX3',
  }},

  // Recessed surface (paper-style).
  Surface: { type: 'Box', style: {
    padding: 'theme:spaceX6',
    backgroundColor: 'theme:bg2',
    borderRadius: 'theme:radiusMd',
  }, variants: {
    light: { style: {
      padding: 'theme:spaceX7',
      backgroundColor: 'theme:paperAlt',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusLg',
    } },
    dark: { style: {
      padding: 'theme:spaceX5',
      backgroundColor: 'theme:bg',
      borderWidth: 1,
      borderColor: 'theme:rule',
      borderRadius: 'theme:radiusSm',
    } },
  }},

  // Alternate-tier surface (paperAlt-style).
  SurfaceAlt: { type: 'Box', style: {
    padding: 'theme:spaceX6',
    backgroundColor: 'theme:bg1',
    borderRadius: 'theme:radiusMd',
  }, variants: {
    light: { style: {
      padding: 'theme:spaceX7',
      backgroundColor: 'theme:paper',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusLg',
    } },
    dark: { style: {
      padding: 'theme:spaceX5',
      backgroundColor: 'theme:bg2',
      borderWidth: 1,
      borderColor: 'theme:ruleBright',
      borderRadius: 'theme:radiusSm',
    } },
  }},

  // Elevated demo well — for interactive previews.
  Well: { type: 'Box', style: {
    padding: 'theme:spaceX7',
    backgroundColor: 'theme:bg1',
    borderRadius: 'theme:radiusLg',
    gap: 'theme:spaceX5',
  }, variants: {
    light: { style: {
      padding: 'theme:spaceX8',
      backgroundColor: 'theme:paper',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusXl',
      gap: 'theme:spaceX6',
    } },
    dark: { style: {
      padding: 'theme:spaceX5',
      backgroundColor: 'theme:bg2',
      borderWidth: 1,
      borderColor: 'theme:ruleBright',
      borderRadius: 'theme:radiusSm',
      gap: 'theme:spaceX4',
    } },
  }},

  // Recessed input area for displaying values.
  InputWell: { type: 'Box', style: {
    backgroundColor: 'theme:bg2',
    borderRadius: 'theme:radiusSm',
    padding: 'theme:spaceX3',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paper',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusMd',
      padding: 'theme:spaceX4',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg',
      borderWidth: 1,
      borderColor: 'theme:rule',
      borderRadius: 'theme:radiusSm',
      padding: 'theme:spaceX3',
    } },
  }},

  // ══════════════════════════════════════════════════════════════
  //   Sections + section labels
  // ══════════════════════════════════════════════════════════════

  Section: { type: 'Box', style: {
    gap: 'theme:spaceX6',
  }, variants: {
    light: { style: { gap: 'theme:spaceX7' } },
    dark: { style: { gap: 'theme:spaceX4' } },
  }},

  SectionBody: { type: 'Box', style: {
    gap: 'theme:spaceX4',
  }, variants: {
    light: { style: { gap: 'theme:spaceX5' } },
    dark: { style: { gap: 'theme:spaceX3' } },
  }},

  SectionLabel: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX3',
  }, variants: {
    light: { style: {
      gap: 'theme:spaceX4',
      paddingBottom: 'theme:spaceX2',
      borderBottomWidth: 1,
      borderColor: 'theme:paperRule',
    } },
    dark: { style: {
      gap: 'theme:spaceX2',
      paddingLeft: 'theme:spaceX3',
      borderLeftWidth: 2,
      borderColor: 'theme:accentHot',
    } },
  }},

  KV: { type: 'Box', style: { flexDirection: 'row',
    gap: 'theme:spaceX3',
    alignItems: 'flex-start',
  }, variants: {
    light: { style: { gap: 'theme:spaceX4' } },
    dark: { style: { gap: 'theme:spaceX2' } },
  }},

  // ══════════════════════════════════════════════════════════════
  //   Buttons (Pressable)
  // ══════════════════════════════════════════════════════════════

  Button: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX7', paddingRight: 'theme:spaceX7',
    paddingTop: 'theme:spaceX4', paddingBottom: 'theme:spaceX4',
    borderRadius: 'theme:radiusMd',
    backgroundColor: 'theme:accent',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX8',
      paddingRight: 'theme:spaceX8',
      borderRadius: 'theme:radiusRound',
      backgroundColor: 'theme:accent',
    } },
    dark: { style: {
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:accentHot',
      borderWidth: 1,
      borderColor: 'theme:accentHot',
    } },
  }},

  ButtonOutline: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX7', paddingRight: 'theme:spaceX7',
    paddingTop: 'theme:spaceX4', paddingBottom: 'theme:spaceX4',
    borderRadius: 'theme:radiusMd',
    borderWidth: 1, borderColor: 'theme:rule',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX8',
      paddingRight: 'theme:spaceX8',
      borderRadius: 'theme:radiusRound',
      borderColor: 'theme:accent',
      backgroundColor: 'theme:paper',
    } },
    dark: { style: {
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
      borderRadius: 'theme:radiusSm',
      borderColor: 'theme:ruleBright',
      backgroundColor: 'theme:bg2',
    } },
  }},

  // ══════════════════════════════════════════════════════════════
  //   Badges
  // ══════════════════════════════════════════════════════════════

  BadgeNeutral: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX4',
      paddingRight: 'theme:spaceX4',
      borderRadius: 'theme:radiusRound',
      backgroundColor: 'theme:paperAlt',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bg',
      borderWidth: 1,
      borderColor: 'theme:rule',
    } },
  }},

  BadgeAccent: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:accent',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX4',
      paddingRight: 'theme:spaceX4',
      borderRadius: 'theme:radiusRound',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:accentHot',
    } },
  }},

  BadgeSuccess: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:ok',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX4',
      paddingRight: 'theme:spaceX4',
      borderRadius: 'theme:radiusRound',
    } },
    dark: { style: { borderRadius: 'theme:radiusSm' } },
  }},

  BadgeError: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:flag',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX4',
      paddingRight: 'theme:spaceX4',
      borderRadius: 'theme:radiusRound',
    } },
    dark: { style: { borderRadius: 'theme:radiusSm' } },
  }},

  BadgeWarning: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:warn',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX4',
      paddingRight: 'theme:spaceX4',
      borderRadius: 'theme:radiusRound',
    } },
    dark: { style: { borderRadius: 'theme:radiusSm' } },
  }},

  BadgeInfo: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:blue',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX4',
      paddingRight: 'theme:spaceX4',
      borderRadius: 'theme:radiusRound',
    } },
    dark: { style: { borderRadius: 'theme:radiusSm' } },
  }},

  // ══════════════════════════════════════════════════════════════
  //   Pills + chips + dots
  // ══════════════════════════════════════════════════════════════

  Chip: { type: 'Box', style: {
    backgroundColor: 'theme:bg2',
    borderRadius: 'theme:radiusSm',
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paperAlt',
      borderRadius: 'theme:radiusRound',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      paddingLeft: 'theme:spaceX4',
      paddingRight: 'theme:spaceX4',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg',
      borderRadius: 'theme:radiusSm',
      borderWidth: 1,
      borderColor: 'theme:rule',
    } },
  }},

  // ══════════════════════════════════════════════════════════════
  //   Command composer chrome
  // ══════════════════════════════════════════════════════════════

  CommandComposerFrame: { type: 'Box', style: {
    flexDirection: 'column',
    width: '100%',
    minHeight: 206,
    minWidth: 0,
    backgroundColor: 'theme:bg',
    borderWidth: 1,
    borderColor: 'theme:accentHot',
    overflow: 'hidden',
  }, bp: {
    // Compact mode — header and footer are JSX-suppressed at sm by the
    // host (cart/app/InputStrip.tsx). Drop the frame's reserved space so
    // it doesn't keep claiming room for chrome that isn't rendered.
    sm: { style: { minHeight: 80 } },
  }},

  CommandComposerTopbar: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    paddingLeft: 12, paddingRight: 12,
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
    gap: 12,
    backgroundColor: 'theme:bg1',
  }},

  CommandComposerMain: { type: 'Box', style: {
    flexGrow: 1,
    justifyContent: 'space-between',
    minHeight: 132,
    paddingLeft: 32, paddingRight: 24,
    paddingTop: 22, paddingBottom: 14,
    gap: 12,
  }},

  CommandComposerFooter: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    paddingLeft: 8, paddingRight: 10,
    borderTopWidth: 1,
    borderColor: 'theme:rule',
    gap: 8,
    backgroundColor: 'theme:bg1',
  }},

  CommandComposerPromptRows: { type: 'Box', style: {
    gap: 8,
    minWidth: 0,
  }},

  CommandComposerTopCluster: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    height: 24,
    gap: 8,
    minWidth: 0,
  }},

  CommandComposerActionRow: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
  }},

  CommandComposerShortcutGroup: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    height: 18,
    flexShrink: 0,
    gap: 5,
  }},

  CommandComposerFooterShortcuts: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    height: 18,
    flexShrink: 0,
    gap: 10,
  }},

  CommandComposerPromptFlow: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    minWidth: 0,
  }},

  CommandComposerChip: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingLeft: 8, paddingRight: 8,
    borderWidth: 1,
    borderColor: 'theme:rule',
    backgroundColor: 'theme:bg1',
  }},

  CommandComposerChipAccent: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingLeft: 8, paddingRight: 8,
    borderWidth: 1,
    borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg2',
  }},

  CommandComposerChipSuccess: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingLeft: 8, paddingRight: 8,
    borderWidth: 1,
    borderColor: 'theme:ok',
    backgroundColor: 'theme:bg2',
  }},

  CommandComposerReference: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingLeft: 10, paddingRight: 10,
    borderWidth: 1,
    borderColor: 'theme:accent',
    backgroundColor: 'theme:bg2',
  }},

  CommandComposerVariableRef: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingLeft: 10, paddingRight: 10,
    borderWidth: 1,
    borderColor: 'theme:warn',
    backgroundColor: 'theme:bg2',
  }},

  CommandComposerCommandRef: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 26,
    paddingLeft: 10, paddingRight: 10,
    borderWidth: 1,
    borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg2',
    shadowColor: 'theme:accentHot',
    shadowBlur: 8,
  }},

  CommandComposerKeycap: { type: 'Box', style: {
    minWidth: 20,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4, paddingRight: 4,
    borderWidth: 1,
    borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg2',
  }},

  CommandComposerSend: { type: 'Pressable', style: {
    minWidth: 84,
    height: 32,
    paddingLeft: 14, paddingRight: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'theme:accentHot',
  }},

  CommandComposerIconButton: { type: 'Pressable', style: {
    width: 48,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg2',
  }},

  CommandComposerInlineIconSlot: { type: 'Box', style: {
    width: 13, height: 13, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }},

  CommandComposerPromptIconSlot: { type: 'Box', style: {
    width: 14, height: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }},

  CommandComposerToolbarIconSlot: { type: 'Box', style: {
    width: 12, height: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }},

  CommandComposerMetaText: { type: 'Text', size: 9, color: 'theme:inkDimmer',
                             style: { fontFamily: 'theme:fontMono', letterSpacing: 4, lineHeight: 11, whiteSpace: 'pre' } },
  CommandComposerMutedText: { type: 'Text', size: 12, color: 'theme:inkDim',
                              style: { fontFamily: 'theme:fontMono', lineHeight: 14, whiteSpace: 'pre' } },
  CommandComposerShortcutText: { type: 'Text', size: 10, color: 'theme:inkDim',
                                 style: { fontFamily: 'theme:fontMono', flexShrink: 0, lineHeight: 12, whiteSpace: 'pre' } },
  CommandComposerPromptText: { type: 'Text', size: 18, color: 'theme:ink',
                               style: { fontFamily: 'theme:fontSans', lineHeight: 22 } },
  CommandComposerTokenText: { type: 'Text', size: 13, color: 'theme:accent',
                              style: { fontFamily: 'theme:fontMono', lineHeight: 16, whiteSpace: 'pre' } },
  CommandComposerHotText: { type: 'Text', size: 13, color: 'theme:accentHot',
                            style: { fontFamily: 'theme:fontMono', lineHeight: 16, whiteSpace: 'pre' } },
  CommandComposerKeycapText: { type: 'Text', size: 10, color: 'theme:accentHot',
                               style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre' } },
  CommandComposerWarnText: { type: 'Text', size: 13, color: 'theme:warn',
                             style: { fontFamily: 'theme:fontMono', lineHeight: 16, whiteSpace: 'pre' } },
  CommandComposerSuccessText: { type: 'Text', size: 13, color: 'theme:ok',
                                style: { fontFamily: 'theme:fontMono', lineHeight: 16, whiteSpace: 'pre' } },
  CommandComposerActionText: { type: 'Text', size: 11, bold: true, color: 'theme:bg',
                               style: { fontFamily: 'theme:fontMono', letterSpacing: 3, lineHeight: 13, whiteSpace: 'pre' } },
  CommandComposerIconText: { type: 'Text', size: 18, bold: true, color: 'theme:ink',
                             style: { fontFamily: 'theme:fontMono', lineHeight: 20, whiteSpace: 'pre' } },

  // ══════════════════════════════════════════════════════════════
  //   Spreadsheet chrome
  // ══════════════════════════════════════════════════════════════

  SpreadsheetFrame: { type: 'Box', style: {
    flexDirection: 'column',
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    backgroundColor: 'theme:bg',
    borderWidth: 1,
    borderColor: 'theme:rule',
    borderRadius: 'theme:radiusLg',
    overflow: 'hidden',
  }},

  SpreadsheetTopBar: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 46,
    paddingLeft: 'theme:spaceX7',
    paddingRight: 'theme:spaceX7',
    paddingTop: 'theme:spaceX5',
    paddingBottom: 'theme:spaceX5',
    gap: 'theme:spaceX6',
    backgroundColor: 'theme:bg1',
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetTopCluster: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 'theme:spaceX3',
    minWidth: 0,
  }},

  SpreadsheetFormulaBar: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    paddingLeft: 'theme:spaceX6',
    paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX4',
    paddingBottom: 'theme:spaceX4',
    gap: 'theme:spaceX4',
    backgroundColor: 'theme:bg',
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetNameBox: { type: 'Box', style: {
    width: 58,
    height: 28,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'theme:ruleBright',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
  }},

  SpreadsheetFormulaInput: { type: 'Box', style: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    height: 28,
    justifyContent: 'center',
    paddingLeft: 'theme:spaceX5',
    paddingRight: 'theme:spaceX5',
    borderWidth: 1,
    borderColor: 'theme:rule',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
  }},

  SpreadsheetAdjustments: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 'theme:spaceX3',
  }},

  SpreadsheetToolbarButton: { type: 'Pressable', style: {
    minWidth: 46,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 'theme:spaceX4',
    paddingRight: 'theme:spaceX4',
    borderWidth: 1,
    borderColor: 'theme:rule',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
  }},

  SpreadsheetGridSlot: { type: 'Box', style: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    minWidth: 0,
    backgroundColor: 'theme:bg2',
  }},

  SpreadsheetGridSurface: { type: 'Box', style: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    minWidth: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: 'theme:bg2',
  }},

  SpreadsheetGridContent: { type: 'Box', style: {
    flexDirection: 'column',
    flexShrink: 0,
    alignSelf: 'flex-start',
  }},

  SpreadsheetGridRow: { type: 'Box', style: {
    flexDirection: 'row',
    flexShrink: 0,
  }},

  SpreadsheetCornerCell: { type: 'Box', style: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'theme:bg1',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetColumnHeaderCell: { type: 'Box', style: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'theme:bg1',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetRowHeaderCell: { type: 'Box', style: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'theme:bg1',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetCell: { type: 'Pressable', style: {
    flexShrink: 0,
    justifyContent: 'center',
    paddingLeft: 'theme:spaceX3',
    paddingRight: 'theme:spaceX3',
    backgroundColor: 'theme:bg2',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetCellAlt: { type: 'Pressable', style: {
    flexShrink: 0,
    justifyContent: 'center',
    paddingLeft: 'theme:spaceX3',
    paddingRight: 'theme:spaceX3',
    backgroundColor: 'theme:bg1',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetCellSelected: { type: 'Pressable', style: {
    flexShrink: 0,
    justifyContent: 'center',
    paddingLeft: 'theme:spaceX3',
    paddingRight: 'theme:spaceX3',
    backgroundColor: 'theme:bg1',
    borderWidth: 1,
    borderColor: 'theme:accent',
  }},

  SpreadsheetNativeGridSurface: { type: 'Native', style: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    minWidth: 0,
    width: '100%',
    height: '100%',
  }},

  SpreadsheetMetricStrip: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'stretch',
    flexWrap: 'wrap',
    gap: 'theme:spaceX3',
    paddingLeft: 'theme:spaceX6',
    paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX4',
    paddingBottom: 'theme:spaceX4',
    backgroundColor: 'theme:bg1',
    borderTopWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetMetric: { type: 'Box', style: {
    minWidth: 92,
    gap: 'theme:spaceX1',
    paddingLeft: 'theme:spaceX4',
    paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX3',
    paddingBottom: 'theme:spaceX3',
    borderWidth: 1,
    borderColor: 'theme:rule',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
  }},

  SpreadsheetStatusBar: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 26,
    gap: 'theme:spaceX5',
    paddingLeft: 'theme:spaceX6',
    paddingRight: 'theme:spaceX6',
    backgroundColor: 'theme:bg1',
    borderTopWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetBadge: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX4',
    paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX2',
    paddingBottom: 'theme:spaceX2',
    borderWidth: 1,
    borderColor: 'theme:rule',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
  }},

  SpreadsheetBadgeError: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX4',
    paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX2',
    paddingBottom: 'theme:spaceX2',
    borderWidth: 1,
    borderColor: 'theme:flag',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
  }},

  SpreadsheetAtomPad: { type: 'Box', style: {
    width: '100%',
    minWidth: 0,
    padding: 'theme:spaceX6',
    alignItems: 'stretch',
    justifyContent: 'center',
    backgroundColor: 'theme:bg',
    borderWidth: 1,
    borderColor: 'theme:rule',
  }},

  SpreadsheetTitle: { type: 'Text', size: 'theme:typeStrong', bold: true, color: 'theme:ink',
                      style: { fontFamily: 'theme:fontSans', lineHeight: 18 } },
  SpreadsheetSubtitle: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim',
                         style: { fontFamily: 'theme:fontMono', lineHeight: 12 } },
  SpreadsheetLabel: { type: 'Text', size: 'theme:typeMicro', color: 'theme:inkDim',
                      style: { fontFamily: 'theme:fontMono', lineHeight: 10, whiteSpace: 'pre' } },
  SpreadsheetAddressText: { type: 'Text', size: 'theme:typeBody', bold: true, color: 'theme:accent',
                            style: { fontFamily: 'theme:fontMono', lineHeight: 14, whiteSpace: 'pre' } },
  SpreadsheetFormulaText: { type: 'Text', size: 'theme:typeBody', color: 'theme:ink',
                            style: { fontFamily: 'theme:fontMono', lineHeight: 14, whiteSpace: 'pre' } },
  SpreadsheetDimText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDimmer',
                        style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre' } },
  SpreadsheetValueText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:ink',
                          style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre' } },
  SpreadsheetCellText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:ink',
                         style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre' } },
  SpreadsheetCellNumberText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:ink',
                               style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre', textAlign: 'right' } },
  SpreadsheetCellFormulaText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:accent',
                                style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre', textAlign: 'right' } },
  SpreadsheetCellHeaderText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim',
                               style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre' } },
  SpreadsheetMetricAccent: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:accent',
                             style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre' } },
  SpreadsheetErrorText: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:flag',
                          style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre' } },
  SpreadsheetPositiveText: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:ok',
                             style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre' } },
  SpreadsheetNegativeText: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:flag',
                             style: { fontFamily: 'theme:fontMono', lineHeight: 12, whiteSpace: 'pre' } },

  // ══════════════════════════════════════════════════════════════
  //   Git lanes terminal chrome
  // ══════════════════════════════════════════════════════════════

  GitLaneFrame: { type: 'Box', style: {
    flexDirection: 'column',
    width: '100%',
    backgroundColor: 'theme:bg',
    borderWidth: 1,
    borderColor: 'theme:accentHot',
    overflow: 'hidden',
  }},

  GitLaneTopbar: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 26,
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
    gap: 'theme:spaceX5',
    backgroundColor: 'theme:bg1',
  }},

  GitLaneBody: { type: 'Box', style: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    backgroundColor: 'theme:bg',
  }},

  GitLaneSplitBody: { type: 'Box', style: { flexDirection: 'row',
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    backgroundColor: 'theme:bg',
  }},

  GitLaneFooter: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 24,
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
    borderTopWidth: 1,
    borderColor: 'theme:rule',
    gap: 'theme:spaceX5',
    backgroundColor: 'theme:bg1',
    overflow: 'hidden',
  }},

  GitFooterAction: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX3',
    flexShrink: 0,
    minHeight: 14,
  }},

  GitLaneSearchRow: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
    gap: 'theme:spaceX4',
    backgroundColor: 'theme:bg',
  }},

  GitLaneList: { type: 'Box', style: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
  }},

  GitLaneGraphColumn: { type: 'Box', style: {
    width: 84,
    flexShrink: 0,
    borderRightWidth: 1,
    borderColor: 'theme:rule',
  }},

  GitLaneGraphSurface: { type: 'Box', style: {
    width: '100%',
    height: '100%',
    minHeight: 0,
  }},

  GitLaneDetailPane: { type: 'Box', style: {
    flexDirection: 'column',
    width: 254,
    flexShrink: 0,
    borderLeftWidth: 1,
    borderColor: 'theme:rule',
    backgroundColor: 'theme:bg',
  }},

  GitLaneDetailHeader: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
    gap: 'theme:spaceX2',
    backgroundColor: 'theme:bg1',
  }},

  GitCommitRow: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 24,
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    gap: 'theme:spaceX4',
    backgroundColor: 'theme:bg',
  }},

  GitCommitRowActive: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 24,
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    gap: 'theme:spaceX4',
    backgroundColor: 'theme:bg2',
  }},

  GitCommitRowAlert: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 24,
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    gap: 'theme:spaceX4',
    backgroundColor: 'theme:bg',
  }},

  GitDiffFileRow: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 23,
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    gap: 'theme:spaceX3',
  }},

  GitDiffCodeLine: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 22,
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    gap: 'theme:spaceX2',
  }},

  GitDiffCodeAdd: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 22,
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    gap: 'theme:spaceX2',
    backgroundColor: 'theme:bg1',
  }},

  GitDiffCodeRemove: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    minHeight: 22,
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    gap: 'theme:spaceX2',
    backgroundColor: 'theme:bg1',
  }},

  GitKeycap: { type: 'Box', style: {
    minWidth: 16,
    minHeight: 14,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'theme:ruleBright',
    backgroundColor: 'theme:bg2',
  }},

  GitDash: { type: 'Box', style: {
    width: 'theme:spaceX5',
    height: 1,
    backgroundColor: 'theme:rule',
    opacity: 0.85,
  }},

  GitLegendSwatch: { type: 'Box', style: {
    width: 'theme:spaceX5',
    height: 'theme:spaceX5',
    flexShrink: 0,
  }},

  GitTextTitle: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:accentHot',
                  style: { fontFamily: 'theme:fontMono', letterSpacing: 'theme:lsWide', whiteSpace: 'pre' } },
  GitTextMeta: { type: 'Text', size: 'theme:typeTiny', color: 'theme:inkDim',
                 style: { fontFamily: 'theme:fontMono', letterSpacing: 'theme:lsWide', whiteSpace: 'pre' } },
  GitTextGhost: { type: 'Text', size: 'theme:typeTiny', color: 'theme:inkGhost',
                  style: { fontFamily: 'theme:fontMono', fontStyle: 'italic', whiteSpace: 'pre' } },
  GitTextDim: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim',
                style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextInk: { type: 'Text', size: 'theme:typeCaption', color: 'theme:ink',
                style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextAccent: { type: 'Text', size: 'theme:typeCaption', color: 'theme:accent',
                   style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextHot: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:accentHot',
                style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextOk: { type: 'Text', size: 'theme:typeCaption', color: 'theme:ok',
               style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextWarn: { type: 'Text', size: 'theme:typeCaption', color: 'theme:warn',
                 style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextFlag: { type: 'Text', size: 'theme:typeCaption', color: 'theme:flag',
                 style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextBlue: { type: 'Text', size: 'theme:typeCaption', color: 'theme:blue',
                 style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextLilac: { type: 'Text', size: 'theme:typeCaption', color: 'theme:lilac',
                  style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextDetailTitle: { type: 'Text', size: 'theme:typeBody', color: 'theme:ink',
                        style: { fontFamily: 'theme:fontMono', lineHeight: 14 } },
  GitTextDetailMeta: { type: 'Text', size: 'theme:typeTiny', color: 'theme:inkDim',
                       style: { fontFamily: 'theme:fontMono', letterSpacing: 'theme:lsWide', whiteSpace: 'pre' } },
  GitTextBadgeSha: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:bg',
                     style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextFileBase: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:ink',
                     style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextFileDir: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim',
                    style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  GitTextHunk: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:accentHot',
                 style: { fontFamily: 'theme:fontMono', letterSpacing: 'theme:lsWide', whiteSpace: 'pre' } },

  NavPill: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    borderRadius: 'theme:radiusSm',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
      borderRadius: 'theme:radiusRound',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      backgroundColor: 'theme:paper',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      borderWidth: 1,
      borderColor: 'theme:rule',
      backgroundColor: 'theme:bg',
    } },
  }},

  NavPillActive: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
      borderRadius: 'theme:radiusRound',
      backgroundColor: 'theme:accent',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bg2',
      borderWidth: 1,
      borderColor: 'theme:accentHot',
    } },
  }},

  Dot: { type: 'Box', style: {
    width: 'theme:spaceX3', height: 'theme:spaceX3',
    borderRadius: 'theme:radiusSm',
    flexShrink: 0,
  }, variants: {
    light: { style: { borderRadius: 'theme:radiusRound' } },
    dark: { style: { borderRadius: 'theme:radiusSm' } },
  }},

  // Progress track.
  Track: { type: 'Box', style: {
    width: '100%', height: 'theme:spaceX2',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
  }, variants: {
    light: { style: {
      borderRadius: 'theme:radiusRound',
      backgroundColor: 'theme:paperAlt',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bg',
    } },
  }},

  // Progress fill.
  Fill: { type: 'Box', style: {
    height: 'theme:spaceX2',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:accent',
  }, variants: {
    light: { style: { borderRadius: 'theme:radiusRound' } },
    dark: { style: { borderRadius: 'theme:radiusSm', backgroundColor: 'theme:accentHot' } },
  }},

  // ══════════════════════════════════════════════════════════════
  //   Typography roles
  // ══════════════════════════════════════════════════════════════

  Title:        { type: 'Text', size: 'theme:typeHeading', bold: true, color: 'theme:ink' },
  Headline:     { type: 'Text', size: 'theme:typeStrong',  bold: true, color: 'theme:ink' },
  Heading:      { type: 'Text', size: 'theme:typeStrong',  bold: true, color: 'theme:ink' },
  Subheading:   { type: 'Text', size: 'theme:typeBase',    bold: true, color: 'theme:ink' },
  Body:         { type: 'Text', size: 'theme:typeBody',    color: 'theme:ink' },
  BodyDim:      { type: 'Text', size: 'theme:typeBody',    color: 'theme:inkDim' },
  Muted:        { type: 'Text', size: 'theme:typeBody',    color: 'theme:inkDim' },
  Caption:      { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },
  TinyDim:      { type: 'Text', size: 'theme:typeTiny',    color: 'theme:inkDim' },
  MicroDim:     { type: 'Text', size: 'theme:typeMicro',   color: 'theme:inkDim' },
  Label:        { type: 'Text', size: 'theme:typeTiny',    bold: true, color: 'theme:inkDim',
                  style: { letterSpacing: 'theme:lsWide' } },
  Code:         { type: 'Text', size: 'theme:typeCaption', color: 'theme:accent',
                  style: { fontFamily: 'theme:fontMono' } },
  Error:        { type: 'Text', size: 'theme:typeBody',    color: 'theme:flag' },

  // Button-shaped texts.
  ButtonLabel:        { type: 'Text', size: 'theme:typeBody', bold: true, color: 'theme:bg' },
  ButtonOutlineLabel: { type: 'Text', size: 'theme:typeBody', color: 'theme:ink' },

  // Badge texts.
  BadgeNeutralText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },
  BadgeAccentText:  { type: 'Text', size: 'theme:typeCaption', color: 'theme:bg' },
  BadgeSuccessText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:bg' },
  BadgeErrorText:   { type: 'Text', size: 'theme:typeCaption', color: 'theme:bg' },
  BadgeWarningText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:bg' },
  BadgeInfoText:    { type: 'Text', size: 'theme:typeCaption', color: 'theme:bg' },

  // Footer breadcrumb.
  Breadcrumb:       { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },
  BreadcrumbActive: { type: 'Text', size: 'theme:typeCaption', color: 'theme:ink' },

  // ══════════════════════════════════════════════════════════════
  //   Code block + syntax atoms
  // ══════════════════════════════════════════════════════════════

  CodeBlockFrame: { type: 'Box', style: {
    flexDirection: 'column',
    width: '100%',
    minWidth: 0,
    backgroundColor: 'theme:bg2',
    borderWidth: 1,
    borderColor: 'theme:rule',
    borderRadius: 'theme:radiusLg',
    overflow: 'hidden',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusXl',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg',
      borderColor: 'theme:ruleBright',
      borderRadius: 'theme:radiusSm',
    } },
  }},

  CodeBlockHeader: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'theme:spaceX5',
    backgroundColor: 'theme:bg1',
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX4', paddingBottom: 'theme:spaceX4',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paperAlt',
      borderColor: 'theme:paperRule',
      paddingTop: 'theme:spaceX5',
      paddingBottom: 'theme:spaceX5',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg2',
      borderColor: 'theme:accentHot',
      paddingTop: 'theme:spaceX3',
      paddingBottom: 'theme:spaceX3',
    } },
  }},

  CodeBlockMeta: { type: 'Box', style: {
    minWidth: 0,
    gap: 'theme:spaceX1',
  }},

  CodeBlockBadge: { type: 'Box', style: {
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'theme:ruleBright',
    borderRadius: 'theme:radiusSm',
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    backgroundColor: 'theme:bg2',
  }, variants: {
    light: { style: {
      borderRadius: 'theme:radiusRound',
      borderColor: 'theme:accent',
      backgroundColor: 'theme:paper',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      borderColor: 'theme:accentHot',
      backgroundColor: 'theme:bg',
    } },
  }},

  CodeBlockBody: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
    paddingTop: 'theme:spaceX5', paddingBottom: 'theme:spaceX5',
    gap: 'theme:spaceX1',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX7',
      paddingRight: 'theme:spaceX7',
      paddingTop: 'theme:spaceX7',
      paddingBottom: 'theme:spaceX7',
      gap: 'theme:spaceX2',
    } },
    dark: { style: {
      paddingLeft: 'theme:spaceX4',
      paddingRight: 'theme:spaceX4',
      paddingTop: 'theme:spaceX4',
      paddingBottom: 'theme:spaceX4',
      gap: 'theme:spaceX0',
    } },
  }},

  CodeBlockScroll: { type: 'ScrollView', showScrollbar: true, style: {
    width: '100%',
    maxHeight: 360,
  }},

  CodeLine: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 'theme:spaceX4',
    minHeight: 16,
    minWidth: 0,
    borderRadius: 'theme:radiusSm',
  }, variants: {
    light: { style: {
      gap: 'theme:spaceX5',
      minHeight: 20,
      borderRadius: 'theme:radiusMd',
    } },
    dark: { style: {
      gap: 'theme:spaceX3',
      minHeight: 14,
      borderRadius: 'theme:radiusSm',
    } },
  }},

  CodeLineEmphasis: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 'theme:spaceX4',
    minHeight: 16,
    minWidth: 0,
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg1',
  }, variants: {
    light: { style: {
      gap: 'theme:spaceX5',
      minHeight: 20,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:paperAlt',
    } },
    dark: { style: {
      gap: 'theme:spaceX3',
      minHeight: 14,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bg2',
    } },
  }},

  CodeLineNumber: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDimmer',
                    style: { width: 28, textAlign: 'right', fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  CodeLineContent: { type: 'Box', style: { flexDirection: 'row', gap: 0, minWidth: 0 } },
  CodeBlockTitle: { type: 'Text', size: 'theme:typeBase', bold: true, color: 'theme:ink',
                    style: { fontFamily: 'theme:fontSans' } },
  CodeBlockSubtle: { type: 'Text', size: 'theme:typeTiny', color: 'theme:inkDim',
                     style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  CodeBlockBadgeText: { type: 'Text', size: 'theme:typeTiny', color: 'theme:accent',
                        style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  CodeBlockCopyButton: { type: 'Pressable', style: {
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'theme:rule',
    borderRadius: 'theme:radiusSm',
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    backgroundColor: 'theme:bg2',
  }, variants: {
    light: { style: {
      borderRadius: 'theme:radiusRound',
      borderColor: 'theme:paperRule',
      backgroundColor: 'theme:paper',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      borderColor: 'theme:accentHot',
      backgroundColor: 'theme:bg',
    } },
  }},
  CodeBlockCopyText: { type: 'Text', size: 'theme:typeTiny', color: 'theme:inkDim',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },

  SyntaxPlain:       { type: 'Text', size: 'theme:typeCaption', color: 'theme:ink',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxKeyword:     { type: 'Text', size: 'theme:typeCaption', color: 'theme:accent',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxString:      { type: 'Text', size: 'theme:typeCaption', color: 'theme:ok',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxNumber:      { type: 'Text', size: 'theme:typeCaption', color: 'theme:warn',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxComment:     { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDimmer',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre', fontStyle: 'italic' } },
  SyntaxFunction:    { type: 'Text', size: 'theme:typeCaption', color: 'theme:blue',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxType:        { type: 'Text', size: 'theme:typeCaption', color: 'theme:lilac',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxProperty:    { type: 'Text', size: 'theme:typeCaption', color: 'theme:ctx',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxPunctuation: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxOperator:    { type: 'Text', size: 'theme:typeCaption', color: 'theme:flag',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxTag:         { type: 'Text', size: 'theme:typeCaption', color: 'theme:atch',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },
  SyntaxMeta:        { type: 'Text', size: 'theme:typeCaption', color: 'theme:tool',
                       style: { fontFamily: 'theme:fontMono', whiteSpace: 'pre' } },

  // ══════════════════════════════════════════════════════════════
  //   Icons (Image roles)
  // ══════════════════════════════════════════════════════════════

  HeaderIcon:    { type: 'Image', style: { width: 18, height: 18 } },
  SectionIcon:   { type: 'Image', style: { width: 'theme:spaceX5', height: 'theme:spaceX5' } },
  InfoIcon:      { type: 'Image', style: { width: 'theme:spaceX6', height: 'theme:spaceX6' } },
  FooterIcon:    { type: 'Image', style: { width: 'theme:spaceX6', height: 'theme:spaceX6' },
                   tintColor: 'theme:inkDim' },
  Icon8:         { type: 'Image', style: { width: 'theme:spaceX4', height: 'theme:spaceX4' } },
  Icon10:        { type: 'Image', style: { width: 'theme:spaceX5', height: 'theme:spaceX5' } },
  Icon12:        { type: 'Image', style: { width: 'theme:spaceX6', height: 'theme:spaceX6' } },
  Icon20:        { type: 'Image', style: { width: 20, height: 20 } },
  DimIcon8:      { type: 'Image', style: { width: 'theme:spaceX4', height: 'theme:spaceX4' },
                   tintColor: 'theme:inkDim' },
  DimIcon12:     { type: 'Image', style: { width: 'theme:spaceX6', height: 'theme:spaceX6' },
                   tintColor: 'theme:inkDim' },
  TextIcon12:    { type: 'Image', style: { width: 'theme:spaceX6', height: 'theme:spaceX6' },
                   tintColor: 'theme:ink' },
  AccentIcon20:  { type: 'Image', style: { width: 20, height: 20 },
                   tintColor: 'theme:accent' },

  // ══════════════════════════════════════════════════════════════
  //   Existing entries — token-ified, names preserved.
  //   These are consumed by ~50 component files already; renaming
  //   would break them. Values now resolve from cockpit theme.
  // ══════════════════════════════════════════════════════════════

  // ── Type ladder (matches theme.type.*) ─────────────────────
  TypeMicro:     { type: 'Text', size: 'theme:typeMicro',   style: { fontFamily: 'theme:fontMono' } },
  TypeMicroBold: { type: 'Text', size: 'theme:typeMicro',   bold: true, style: { fontFamily: 'theme:fontMono' } },
  TypeTiny:      { type: 'Text', size: 'theme:typeTiny',    style: { fontFamily: 'theme:fontMono' } },
  TypeTinyBold:  { type: 'Text', size: 'theme:typeTiny',    bold: true, style: { fontFamily: 'theme:fontMono' } },
  TypeCaption:   { type: 'Text', size: 'theme:typeCaption', style: { fontFamily: 'theme:fontMono' } },
  TypeBody:      { type: 'Text', size: 'theme:typeBody',    style: { fontFamily: 'theme:fontMono' } },
  TypeBodyBold:  { type: 'Text', size: 'theme:typeBody',    bold: true, style: { fontFamily: 'theme:fontMono' } },
  TypeBase:      { type: 'Text', size: 'theme:typeBase',    style: { fontFamily: 'theme:fontMono' } },

  // ── Inline (Row) rhythm (matches theme.spacing x*) ─────────
  InlineX2:           { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spaceX2' } },
  InlineX3:           { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spaceX3' } },
  InlineX4:           { type: 'Box', style: { flexDirection: 'row', gap: 'theme:spaceX4', alignItems: 'stretch' } },
  InlineX4Center:     { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spaceX4' } },
  InlineX5:           { type: 'Box', style: { flexDirection: 'row', gap: 'theme:spaceX5', alignItems: 'center' } },
  InlineX5Between:    { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'theme:spaceX5' } },
  InlineX4BetweenFull:{ type: 'Box', style: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', gap: 'theme:spaceX4' } },

  // ── Stack (Col) rhythm (matches theme.spacing x*) ──────────
  StackX1:        { type: 'Box', style: { gap: 'theme:spaceX1' } },
  StackX1Center:  { type: 'Box', style: { alignItems: 'center', gap: 'theme:spaceX1' } },
  StackX2:        { type: 'Box', style: { gap: 'theme:spaceX2' } },
  StackX3:        { type: 'Box', style: { gap: 'theme:spaceX3' } },
  StackX4:        { type: 'Box', style: { gap: 'theme:spaceX4' } },
  StackX4Center:  { type: 'Box', style: { alignItems: 'center', gap: 'theme:spaceX4' } },
  StackX5:        { type: 'Box', style: { gap: 'theme:spaceX5' } },
  StackX5Center:  { type: 'Box', style: { gap: 'theme:spaceX5', alignItems: 'center' } },
  StackX6:        { type: 'Box', style: { gap: 'theme:spaceX6' } },

  // ── Radius primitives (matches theme.radius.*) ─────────────
  DotSm:     { type: 'Box', style: { width: 'theme:spaceX4', height: 'theme:spaceX4', borderRadius: 'theme:radiusSm' } },
  DotMd:     { type: 'Box', style: { width: 'theme:spaceX6', height: 'theme:spaceX6', borderRadius: 'theme:radiusMd', borderWidth: 1 } },
  RoundPill: { type: 'Box', style: { borderRadius: 'theme:radiusLg' } },
  ChipRound: { type: 'Box', style: { paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4', paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2', borderRadius: 'theme:radiusMd', borderWidth: 1 } },

  // ── Layout utilities ──────────────────────────────────────
  // Graph with top-left origin, fills parent.
  BareGraph: { type: 'Graph', originTopLeft: true, style: { width: '100%', height: '100%' } },

  Spacer:    { type: 'Box', style: { flexGrow: 1 } },
  HalfPress: { type: 'Pressable', style: { flexGrow: 1, flexBasis: 0 } },

  // --------------------------------------------------------------
  //   Social image gallery
  // --------------------------------------------------------------

  SocialGalleryShell: { type: 'Box', style: {
    flexDirection: 'column',
    width: '100%', height: '100%',
    minWidth: 0, minHeight: 0,
    backgroundColor: 'theme:bg',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusLg',
    overflow: 'hidden',
  }},
  SocialGalleryMain: { type: 'Box', style: {
    flexDirection: 'row',
    flexGrow: 1, flexShrink: 1,
    minWidth: 0, minHeight: 0,
    backgroundColor: 'theme:bg',
  }},
  SocialGalleryViewerPane: { type: 'Box', style: {
    flexDirection: 'column',
    flexGrow: 1, flexShrink: 1, flexBasis: 0,
    minWidth: 0, minHeight: 0,
    padding: 'theme:spaceX6',
    gap: 'theme:spaceX5',
    backgroundColor: 'theme:bg2',
  }},
  SocialGalleryMediaShell: { type: 'Box', style: {
    flexDirection: 'column',
    flexGrow: 1, flexShrink: 1,
    minHeight: 0,
    gap: 'theme:spaceX4',
  }},
  SocialGalleryMediaRow: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1, flexShrink: 1,
    minHeight: 0,
    gap: 'theme:spaceX4',
  }},
  SocialGalleryMediaFrame: { type: 'Box', style: {
    flexGrow: 1, flexShrink: 1, flexBasis: 0,
    minWidth: 0, minHeight: 260,
    borderRadius: 'theme:radiusLg',
    borderWidth: 1, borderColor: 'theme:ruleBright',
    backgroundColor: 'theme:bg',
    overflow: 'hidden',
  }},
  SocialGalleryImage: { type: 'Image', style: {
    width: '100%', height: '100%',
    minHeight: 260,
    backgroundColor: 'theme:bg',
    objectFit: 'cover',
  }},
  SocialGalleryNavButton: { type: 'Pressable', style: {
    width: 34, height: 54,
    flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
    backgroundColor: 'theme:bg1',
  }},
  SocialGalleryOverlayBar: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'theme:spaceX5',
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
    paddingTop: 'theme:spaceX4', paddingBottom: 'theme:spaceX4',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
    backgroundColor: 'theme:bg1',
  }},
  SocialGalleryThumbRail: { type: 'ScrollView', horizontal: true, showScrollbar: false, style: {
    width: '100%',
    maxHeight: 76,
    flexShrink: 0,
  }},
  SocialGalleryThumbRailInner: { type: 'Box', style: {
    flexDirection: 'row',
    gap: 'theme:spaceX4',
  }},
  SocialGalleryThumb: { type: 'Pressable', style: {
    width: 74, height: 58,
    flexShrink: 0,
    borderRadius: 'theme:radiusMd',
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg1',
    overflow: 'hidden',
  }},
  SocialGalleryThumbActive: { type: 'Pressable', style: {
    width: 74, height: 58,
    flexShrink: 0,
    borderRadius: 'theme:radiusMd',
    borderWidth: 2, borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg1',
    overflow: 'hidden',
  }},
  SocialGalleryThumbImage: { type: 'Image', style: {
    width: '100%', height: '100%',
    objectFit: 'cover',
    backgroundColor: 'theme:bg2',
  }},
  SocialGalleryMetaPanel: { type: 'Box', style: {
    flexDirection: 'column',
    width: 310,
    flexShrink: 0,
    minHeight: 0,
    borderLeftWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg1',
  }},
  SocialGalleryMetaScroll: { type: 'ScrollView', showScrollbar: true, style: {
    flexGrow: 1,
    minHeight: 0,
  }},
  SocialGalleryMetaInner: { type: 'Box', style: {
    flexDirection: 'column',
    padding: 'theme:spaceX6',
    gap: 'theme:spaceX6',
  }},
  SocialGalleryAuthorRow: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 'theme:spaceX5',
  }},
  SocialGalleryAvatar: { type: 'Box', style: {
    width: 42, height: 42,
    flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 'theme:radiusLg',
    borderWidth: 1, borderColor: 'theme:accent',
    backgroundColor: 'theme:bg2',
  }},
  SocialGalleryTopicRow: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'theme:spaceX3',
  }},
  SocialGalleryTopic: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    borderRadius: 'theme:radiusSm',
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg2',
  }},
  SocialGalleryCaptionBlock: { type: 'Box', style: {
    flexDirection: 'column',
    gap: 'theme:spaceX3',
  }},
  SocialGalleryActionBar: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX3',
    paddingTop: 'theme:spaceX5',
    borderTopWidth: 1, borderColor: 'theme:rule',
    overflow: 'hidden',
  }},
  SocialGalleryActionButton: { type: 'Pressable', style: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 28,
    flexShrink: 0,
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    gap: 'theme:spaceX2',
    borderRadius: 'theme:radiusMd',
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg2',
  }},
  SocialGalleryActionButtonActive: { type: 'Pressable', style: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 28,
    flexShrink: 0,
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    gap: 'theme:spaceX2',
    borderRadius: 'theme:radiusMd',
    borderWidth: 1, borderColor: 'theme:accent',
    backgroundColor: 'theme:bg2',
  }},
  SocialGalleryActionIconSlot: { type: 'Box', style: {
    width: 15, height: 15,
    flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
  }},
  SocialGalleryCommentList: { type: 'Box', style: {
    flexDirection: 'column',
    gap: 'theme:spaceX5',
    paddingTop: 'theme:spaceX5',
    borderTopWidth: 1, borderColor: 'theme:rule',
  }},
  SocialGalleryCommentRow: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 'theme:spaceX4',
  }},
  SocialGalleryCommentAvatar: { type: 'Box', style: {
    width: 26, height: 26,
    flexShrink: 0,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 'theme:radiusMd',
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg2',
  }},
  SocialGalleryCommentBody: { type: 'Box', style: {
    flexDirection: 'column',
    flexGrow: 1, flexShrink: 1, flexBasis: 0,
    minWidth: 0,
    gap: 'theme:spaceX2',
  }},
  SocialGalleryComposer: { type: 'Pressable', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX4',
    minHeight: 38,
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    borderRadius: 'theme:radiusMd',
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg2',
  }},
  SocialGalleryIcon: { type: 'Icon', size: 15, color: 'theme:inkDim', strokeWidth: 2.1 },
  SocialGalleryIconInk: { type: 'Icon', size: 15, color: 'theme:ink', strokeWidth: 2.1 },
  SocialGalleryIconAccent: { type: 'Icon', size: 15, color: 'theme:accentHot', strokeWidth: 2.2 },
  SocialGalleryIconOk: { type: 'Icon', size: 15, color: 'theme:ok', strokeWidth: 2.2 },
  SocialGalleryIconBlue: { type: 'Icon', size: 15, color: 'theme:blue', strokeWidth: 2.2 },
  SocialGalleryAuthorName: { type: 'Text', size: 'theme:typeBase', bold: true, color: 'theme:ink',
                             style: { fontFamily: 'theme:fontSans', lineHeight: 15 } },
  SocialGalleryHandle: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim',
                         style: { fontFamily: 'theme:fontMono', lineHeight: 13 } },
  SocialGalleryMetaText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim',
                           style: { fontFamily: 'theme:fontSans', lineHeight: 14 } },
  SocialGalleryCaption: { type: 'Text', size: 'theme:typeBase', color: 'theme:ink',
                          style: { fontFamily: 'theme:fontSans', lineHeight: 18 } },
  SocialGalleryImageTitle: { type: 'Text', size: 'theme:typeStrong', bold: true, color: 'theme:ink',
                             style: { fontFamily: 'theme:fontSans', lineHeight: 18 } },
  SocialGalleryCount: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:ink',
                        style: { fontFamily: 'theme:fontMono', lineHeight: 13 } },
  SocialGalleryTopicText: { type: 'Text', size: 'theme:typeTiny', bold: true, color: 'theme:inkDim',
                            style: { fontFamily: 'theme:fontMono', lineHeight: 11 } },
  SocialGalleryAvatarText: { type: 'Text', size: 'theme:typeBody', bold: true, color: 'theme:ink',
                             style: { fontFamily: 'theme:fontMono', lineHeight: 13 } },

  // ══════════════════════════════════════════════════════════════
  //   Document viewer
  // ══════════════════════════════════════════════════════════════

  // Outer dark frame.
  DocShell: { type: 'Box', style: {
    flexDirection: 'column',
    width: '100%', height: '100%',
    backgroundColor: 'theme:bg2',
    borderRadius: 'theme:radiusSm',
    overflow: 'hidden',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paperAlt',
      borderRadius: 'theme:radiusXl',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg',
      borderRadius: 'theme:radiusSm',
      borderWidth: 1,
      borderColor: 'theme:ruleBright',
    } },
  }},

  // Top toolbar strip.
  DocToolbar: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    width: '100%',
    height: 'theme:chromeStrip',
    backgroundColor: 'theme:bg2',
    borderBottomWidth: 1, borderColor: 'theme:rule',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    gap: 'theme:spaceX5',
    flexShrink: 0,
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRule',
      height: 'theme:chromeStrip',
      paddingLeft: 'theme:spaceX7',
      paddingRight: 'theme:spaceX7',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg2',
      borderColor: 'theme:accentHot',
      height: 'theme:chromeStrip',
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
    } },
  }},

  // Toolbar slot for the title block (grows to fill).
  DocToolbarTitleSlot: { type: 'Box', style: {
    flexDirection: 'column',
    flexGrow: 1, flexShrink: 1,
    gap: 'theme:spaceX0',
  }},

  // Toolbar icon button (square, outlined).
  DocToolbarBtn: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    borderRadius: 'theme:radiusSm',
    borderWidth: 1, borderColor: 'theme:rule',
    alignItems: 'center', justifyContent: 'center',
  }, variants: {
    light: { style: {
      borderRadius: 'theme:radiusRound',
      borderColor: 'theme:paperRule',
      backgroundColor: 'theme:paperAlt',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      borderColor: 'theme:ruleBright',
      backgroundColor: 'theme:bg',
    } },
  }},
  DocToolbarBtnActive: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:accent',
    alignItems: 'center', justifyContent: 'center',
  }, variants: {
    light: { style: {
      borderRadius: 'theme:radiusRound',
      backgroundColor: 'theme:accent',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:accentHot',
    } },
  }},

  // Document body (toolbar | content split).
  DocBody: { type: 'Box', style: {
    flexDirection: 'row',
    flexGrow: 1, flexShrink: 1,
    width: '100%',
  }, variants: {
    light: { style: { gap: 'theme:spaceX5', padding: 'theme:spaceX5' } },
    dark: { style: { gap: 0, padding: 0 } },
  }},

  // Paper-cream sidebar outline.
  DocOutline: { type: 'Box', style: {
    flexDirection: 'column',
    width: 200,
    flexShrink: 0,
    backgroundColor: 'theme:paper',
    borderRightWidth: 1, borderColor: 'theme:paperRule',
  }, variants: {
    light: { style: {
      width: 240,
      borderRightWidth: 0,
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:paper',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
    } },
    dark: { style: {
      width: 180,
      backgroundColor: 'theme:bg2',
      borderRightWidth: 1,
      borderColor: 'theme:rule',
    } },
  }},
  DocOutlineHeader: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX5', paddingBottom: 'theme:spaceX3',
    borderBottomWidth: 1, borderColor: 'theme:paperRule',
  }},
  DocOutlineRow: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    borderLeftWidth: 2, borderColor: 'theme:paper',
  }},
  DocOutlineRowActive: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    backgroundColor: 'theme:paperAlt',
    borderLeftWidth: 2, borderColor: 'theme:paperRuleBright',
  }},

  // Page slot (right of outline) — dark frame around the paper.
  DocPageWrap: { type: 'Box', style: {
    flexGrow: 1, flexShrink: 1,
    padding: 'theme:spaceX6',
    backgroundColor: 'theme:bg2',
  }, variants: {
    light: { style: {
      padding: 'theme:spaceX7',
      backgroundColor: 'theme:paperAlt',
      borderRadius: 'theme:radiusLg',
    } },
    dark: { style: {
      padding: 'theme:spaceX4',
      backgroundColor: 'theme:bg',
    } },
  }},
  // Page surface — cream paper.
  DocPage: { type: 'Box', style: {
    flexGrow: 1, flexShrink: 1,
    flexDirection: 'column',
    backgroundColor: 'theme:paper',
    borderWidth: 1, borderColor: 'theme:paperRule',
    borderRadius: 'theme:radiusSm',
    overflow: 'hidden',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusLg',
    } },
    dark: { style: {
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRuleBright',
      borderRadius: 'theme:radiusSm',
    } },
  }},
  // Inner padded content column inside the page.
  DocPageContent: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    paddingTop: 'theme:spaceX8', paddingBottom: 'theme:spaceX8',
    gap: 'theme:spaceX5',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX8',
      paddingRight: 'theme:spaceX8',
      paddingTop: 'theme:spaceX8',
      paddingBottom: 'theme:spaceX8',
      gap: 'theme:spaceX6',
    } },
    dark: { style: {
      paddingLeft: 'theme:spaceX6',
      paddingRight: 'theme:spaceX6',
      paddingTop: 'theme:spaceX6',
      paddingBottom: 'theme:spaceX6',
      gap: 'theme:spaceX4',
    } },
  }},

  // Code block (recessed dark surface).
  DocCode: { type: 'Box', style: {
    backgroundColor: 'theme:bg2',
    borderRadius: 'theme:radiusSm',
    padding: 'theme:spaceX5',
  }, variants: {
    light: { style: {
      backgroundColor: 'theme:paperAlt',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusMd',
      padding: 'theme:spaceX6',
    } },
    dark: { style: {
      backgroundColor: 'theme:bg',
      borderWidth: 1,
      borderColor: 'theme:ruleBright',
      borderRadius: 'theme:radiusSm',
      padding: 'theme:spaceX4',
    } },
  }},

  // Quote (vertical accent bar + content row).
  DocQuoteRow: { type: 'Box', style: {
    flexDirection: 'row',
    gap: 'theme:spaceX4',
  }},
  DocQuoteBar: { type: 'Box', style: {
    width: 3,
    backgroundColor: 'theme:paperRuleBright',
    borderRadius: 'theme:radiusSm',
    alignSelf: 'stretch',
  }, variants: {
    light: { style: { width: 4, borderRadius: 'theme:radiusRound' } },
    dark: { style: { width: 2, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:accentHot' } },
  }},

  // Paper-rule horizontal divider.
  DocPaperRule: { type: 'Box', style: {
    height: 1, flexShrink: 0,
    backgroundColor: 'theme:paperRule',
  }},

  // Doc typography (text on paper).
  DocTitle:       { type: 'Text', size: 'theme:typeHeading', bold: true, color: 'theme:paperInk' },
  DocSubtitle:    { type: 'Text', size: 'theme:typeStrong',  color: 'theme:paperInkDim',
                    style: { fontStyle: 'italic' } },
  DocMeta:        { type: 'Text', size: 'theme:typeCaption', color: 'theme:paperInkDim' },
  DocH1:          { type: 'Text', size: 'theme:typeHeading', bold: true, color: 'theme:paperInk' },
  DocH2:          { type: 'Text', size: 'theme:typeStrong',  bold: true, color: 'theme:paperInk' },
  DocH3:          { type: 'Text', size: 'theme:typeBase',    bold: true, color: 'theme:paperInk' },
  DocBodyText:    { type: 'Text', size: 'theme:typeBody',    color: 'theme:paperInk' },
  DocBodyDim:     { type: 'Text', size: 'theme:typeBody',    color: 'theme:paperInkDim' },
  DocQuoteText:   { type: 'Text', size: 'theme:typeBase',    color: 'theme:paperInk',
                    style: { fontStyle: 'italic' } },
  DocAttribution: { type: 'Text', size: 'theme:typeCaption', color: 'theme:paperInkDim' },
  DocCodeText:    { type: 'Text', size: 'theme:typeCaption', color: 'theme:ink',
                    style: { fontFamily: 'theme:fontMono' } },

  // Doc typography (text in dark toolbar / shell).
  DocToolbarTitle:   { type: 'Text', size: 'theme:typeBase',    bold: true, color: 'theme:ink' },
  DocToolbarSection: { type: 'Text', size: 'theme:typeMicro',   color: 'theme:inkDim' },
  DocToolbarGlyph:   { type: 'Text', size: 'theme:typeBase',    bold: true, color: 'theme:ink' },
  DocToolbarZoom:    { type: 'Text', size: 'theme:typeTiny',    color: 'theme:ink',
                       style: { fontFamily: 'theme:fontMono' } },

  // Outline typography.
  DocOutlineLabel:        { type: 'Text', size: 'theme:typeMicro',   bold: true, color: 'theme:paperInkDim' },
  DocOutlineEntry:        { type: 'Text', size: 'theme:typeCaption', color: 'theme:paperInkDim' },
  DocOutlineEntryActive:  { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:paperInk' },
  DocOutlineEntryH1:      { type: 'Text', size: 'theme:typeBase',    bold: true, color: 'theme:paperInkDim' },
  DocOutlineEntryH1Active:{ type: 'Text', size: 'theme:typeBase',    bold: true, color: 'theme:paperInk' },

  // ══════════════════════════════════════════════════════════════
  //   cart/app — onboarding flow + custom window chrome
  //
  //   These names are consumed by cart/app/index.tsx, page.jsx,
  //   onboarding/*.jsx. All theme-touching styling for cart/app
  //   lives here — there is no cart/app/theme.js shim. Active /
  //   inactive variants are separate classifiers; the JSX picks one.
  // ══════════════════════════════════════════════════════════════

  // ── Window chrome (top strip) ───────────────────────────────
  AppChrome: { type: 'Box', style: {
    flexDirection: 'row',
    width: '100%', height: 36,
    flexShrink: 0,
    alignItems: 'center', justifyContent: 'space-between',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX3',
    backgroundColor: 'theme:bg1',
    borderBottomWidth: 1, borderColor: 'theme:rule',
  }, variants: {
    light: { style: {
      height: 'theme:chromeTopbar',
      backgroundColor: 'theme:paper',
      borderBottomWidth: 1,
      borderColor: 'theme:paperRule',
      paddingLeft: 'theme:spaceX7',
      paddingRight: 'theme:spaceX5',
    } },
    dark: { style: {
      height: 'theme:chromeTopbar',
      backgroundColor: 'theme:bg2',
      borderBottomWidth: 2,
      borderColor: 'theme:accentHot',
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX3',
    } },
  }},
  AppChromeBrandRow: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX4',
  }},
  AppChromeNavRow: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX2',
  }},
  AppChromeRightCluster: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX2',
  }},
  AppBrandSwatch: { type: 'Box', style: {
    width: 18, height: 18,
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:accentHot',
    borderWidth: 1, borderColor: 'theme:ruleBright',
  }, variants: {
    light: { style: { borderRadius: 'theme:radiusRound' } },
    dark: { style: {} },
  }},
  AppBrandTitle: { type: 'Text', size: 'theme:typeBase', bold: true, color: 'theme:ink' },
  AppBrandSub:   { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },
  AppChromeDivider: { type: 'Box', style: {
    width: 1, height: 18,
    backgroundColor: 'theme:rule',
    marginLeft: 'theme:spaceX4', marginRight: 'theme:spaceX2',
  }},

  // ── Tour banner (chrome, post-onboarding offer) ─────────────
  // Drops into the right cluster the moment onboarding completes. Compact
  // pill — sits flush with the nav row, fades in over the home-entry
  // carryover, and unmounts when the user picks Yes / No.
  AppChromeTourBanner: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX4',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX3',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusRound',
    marginRight: 'theme:spaceX4',
  }},
  AppChromeTourText: { type: 'Text', size: 'theme:typeMeta', color: 'theme:ink' },
  AppChromeTourActions: { type: 'Box', style: {
    flexDirection: 'row',
    gap: 'theme:spaceX2',
    alignItems: 'center',
  }},
  AppChromeTourYes: { type: 'Pressable', style: {
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    borderRadius: 'theme:radiusRound',
    backgroundColor: 'theme:accentHot',
  }},
  AppChromeTourNo: { type: 'Pressable', style: {
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    borderRadius: 'theme:radiusRound',
    backgroundColor: 'theme:transparent',
    borderWidth: 1, borderColor: 'theme:rule',
  }},
  AppChromeTourYesLabel: { type: 'Text', size: 'theme:typeMeta', bold: true, color: 'theme:paper' },
  AppChromeTourNoLabel:  { type: 'Text', size: 'theme:typeMeta', color: 'theme:ink' },

  // ── Nav links (chrome route nav) ────────────────────────────
  AppNavLink: { type: 'Pressable', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX3',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    borderRadius: 'theme:radiusMd',
    backgroundColor: 'theme:transparent',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
      borderRadius: 'theme:radiusRound',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      backgroundColor: 'theme:paper',
    } },
    dark: { style: {
      paddingLeft: 'theme:spaceX3',
      paddingRight: 'theme:spaceX3',
      borderRadius: 'theme:radiusSm',
      borderWidth: 1,
      borderColor: 'theme:rule',
      backgroundColor: 'theme:bg',
    } },
  }},
  AppNavLinkActive: { type: 'Pressable', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX3',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    borderRadius: 'theme:radiusMd',
    backgroundColor: 'theme:bg2',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
      borderRadius: 'theme:radiusRound',
      backgroundColor: 'theme:accent',
    } },
    dark: { style: {
      paddingLeft: 'theme:spaceX3',
      paddingRight: 'theme:spaceX3',
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bg2',
      borderWidth: 1,
      borderColor: 'theme:accentHot',
    } },
  }},
  AppNavIcon:       { type: 'Icon', size: 14, strokeWidth: 2, color: 'theme:inkDim' },
  AppNavIconActive: { type: 'Icon', size: 14, strokeWidth: 2, color: 'theme:ink',
                      variants: {
                        light: { color: 'theme:bg' },
                        dark: { color: 'theme:accentHot' },
                      } },
  AppNavLabel:       { type: 'Text', size: 'theme:typeBase', color: 'theme:inkDim' },
  AppNavLabelActive: { type: 'Text', size: 'theme:typeBase', color: 'theme:ink',
                       variants: {
                         light: { color: 'theme:bg' },
                         dark: { color: 'theme:accentHot' },
                       } },

  // ── Step cubes (onboarding progress in chrome) ──────────────
  AppStepCubePast:    { type: 'Pressable', style: { width: 14, height: 14, backgroundColor: 'theme:inkDim' } },
  AppStepCubeCurrent: { type: 'Pressable', style: { width: 14, height: 14, backgroundColor: 'theme:accent' } },
  AppStepCubeFuture:  { type: 'Pressable', style: { width: 14, height: 14, backgroundColor: 'theme:rule' } },
  AppStepCubeRow:     { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spaceX2' } },

  // ── Window buttons (minimize / maximize / close) ────────────
  AppWindowBtn: { type: 'Pressable', style: {
    width: 26, height: 22,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 'theme:radiusSm',
  }, variants: {
    light: { style: {
      width: 30,
      height: 26,
      borderRadius: 'theme:radiusRound',
      borderWidth: 1,
      borderColor: 'theme:paperRule',
      backgroundColor: 'theme:paper',
    } },
    dark: { style: {
      width: 24,
      height: 20,
      borderRadius: 'theme:radiusSm',
      borderWidth: 1,
      borderColor: 'theme:rule',
      backgroundColor: 'theme:bg',
    } },
  }},
  AppWindowBtnIcon:      { type: 'Icon', size: 14, strokeWidth: 2, color: 'theme:inkDim' },
  AppWindowBtnIconClose: { type: 'Icon', size: 14, strokeWidth: 2, color: 'theme:flag' },

  // ── Onboarding step shell ───────────────────────────────────
  AppStepFrame: { type: 'Box', style: { flexGrow: 1, position: 'relative' } },
  AppStepCenter: { type: 'Box', style: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  }},
  AppStepCenterCol: { type: 'Box', style: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 'theme:spaceX8',
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
  }},
  AppStepBottomLeft:  { type: 'Box', style: { position: 'absolute', bottom: 24, left: 24 } },
  AppStepBottomRight: { type: 'Box', style: { position: 'absolute', bottom: 24, right: 24 } },
  AppStepBottomRightRow: { type: 'Box', style: {
    position: 'absolute',
    bottom: 24, right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX6',
  }},
  AppStepDimmable: { type: 'Box', style: { opacity: 1 } },

  // ── Onboarding text (large, on dark page) ───────────────────
  // FirstStep — "Hello", "what is your name?", greet/exit lines.
  AppHello:        { type: 'Text', size: 48, bold: true, color: 'theme:ink' },
  AppQuestion:     { type: 'Text', size: 16, color: 'theme:inkDim' },
  AppGreet:        { type: 'Text', size: 32, bold: true, color: 'theme:ink' },
  // Step2/Step3 — section prompt + branching exit message.
  AppPromptText:   { type: 'Text', size: 22, bold: true, color: 'theme:ink',
                     style: { textAlign: 'center' } },
  AppExitMessage:  { type: 'Text', size: 32, bold: true, color: 'theme:ink',
                     style: { textAlign: 'center' } },

  // ── Onboarding inputs ───────────────────────────────────────
  AppNameInput: { type: 'TextInput', style: {
    width: 280, height: 36,
    fontSize: 16,
    color: 'theme:ink',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
  }},
  AppFormInput: { type: 'TextInput', style: {
    width: '100%', height: 36,
    fontSize: 13,
    color: 'theme:ink',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
  }},
  AppFormInputMono: { type: 'TextInput', style: {
    width: '100%', height: 36,
    fontSize: 13,
    color: 'theme:ink',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    fontFamily: 'theme:fontMono',
  }},

  // ── Provider tiles (Step2) ──────────────────────────────────
  AppProviderRow: { type: 'Box', style: {
    flexDirection: 'row',
    gap: 'theme:spaceX7',
    alignItems: 'stretch',
    flexWrap: 'wrap',
    justifyContent: 'center',
  }},
  AppProviderTile: { type: 'Pressable', style: {
    width: 240,
    minHeight: 120,
    padding: 'theme:spaceX7',
    backgroundColor: 'theme:bg1',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusXl',
    gap: 'theme:spaceX4',
    justifyContent: 'center',
  }, variants: {
    light: { style: {
      width: 280,
      minHeight: 140,
      padding: 'theme:spaceX8',
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusXl',
      gap: 'theme:spaceX5',
    } },
    dark: { style: {
      width: 220,
      minHeight: 104,
      padding: 'theme:spaceX5',
      backgroundColor: 'theme:bg2',
      borderColor: 'theme:rule',
      borderRadius: 'theme:radiusSm',
      gap: 'theme:spaceX3',
    } },
  }},
  AppProviderTileActive: { type: 'Pressable', style: {
    width: 240,
    minHeight: 120,
    padding: 'theme:spaceX7',
    backgroundColor: 'theme:bg1',
    borderWidth: 2, borderColor: 'theme:accent',
    borderRadius: 'theme:radiusXl',
    gap: 'theme:spaceX4',
    justifyContent: 'center',
  }, variants: {
    light: { style: {
      width: 280,
      minHeight: 140,
      padding: 'theme:spaceX8',
      backgroundColor: 'theme:paper',
      borderWidth: 2,
      borderColor: 'theme:accent',
      borderRadius: 'theme:radiusXl',
      gap: 'theme:spaceX5',
    } },
    dark: { style: {
      width: 220,
      minHeight: 104,
      padding: 'theme:spaceX5',
      backgroundColor: 'theme:bg2',
      borderWidth: 2,
      borderColor: 'theme:accentHot',
      borderRadius: 'theme:radiusSm',
      gap: 'theme:spaceX3',
    } },
  }},
  AppProviderTileTitle:       { type: 'Text', size: 'theme:typeStrong', bold: true, color: 'theme:ink' },
  AppProviderTileTitleActive: { type: 'Text', size: 'theme:typeStrong', bold: true, color: 'theme:accent' },
  AppProviderTileSubtitle:    { type: 'Text', size: 'theme:typeMeta', color: 'theme:inkDim' },

  // ── Inline form shell (Step2 provider forms) ────────────────
  AppFormShell: { type: 'Box', style: {
    flexDirection: 'column',
    width: 480,
    padding: 'theme:spaceX8',
    gap: 'theme:spaceX6',
    backgroundColor: 'theme:bg1',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusXl',
  }, variants: {
    light: { style: {
      width: 540,
      padding: 'theme:spaceX8',
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusXl',
      gap: 'theme:spaceX7',
    } },
    dark: { style: {
      width: 440,
      padding: 'theme:spaceX6',
      backgroundColor: 'theme:bg2',
      borderColor: 'theme:ruleBright',
      borderRadius: 'theme:radiusSm',
      gap: 'theme:spaceX5',
    } },
  }, bp: {
    // At sm the form shell drops its fixed width and fills the parent
    // column. variants get explicit overrides because variant.style would
    // otherwise win the merge against bp.style.
    sm: {
      style: { width: '100%' },
      variants: {
        light: { style: { width: '100%' } },
        dark: { style: { width: '100%' } },
      },
    },
  }},
  AppFormFieldCol: { type: 'Box', style: {
    flexDirection: 'column',
    gap: 'theme:spaceX3',
  }},
  AppFormButtonRow: { type: 'Box', style: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  }},
  AppFormLabel: { type: 'Text', size: 'theme:typeBase', color: 'theme:inkDim' },

  // ── Probe result ────────────────────────────────────────────
  AppProbeResult: { type: 'Box', style: {
    flexDirection: 'column',
    gap: 'theme:spaceX2',
    padding: 'theme:spaceX6',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
  }},
  AppProbeOk:      { type: 'Text', size: 'theme:typeMeta', bold: true, color: 'theme:ok' },
  AppProbeFail:    { type: 'Text', size: 'theme:typeMeta', bold: true, color: 'theme:flag' },
  AppProbeMessage: { type: 'Text', size: 'theme:typeBase', color: 'theme:inkDim',
                     style: { fontFamily: 'theme:fontMono' } },

  // ── Model list (Step2) ──────────────────────────────────────
  AppModelListLabel: { type: 'Text', size: 'theme:typeBase', color: 'theme:inkDim' },
  AppModelListBox: { type: 'Box', style: {
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
    padding: 'theme:spaceX2',
    backgroundColor: 'theme:bg2',
    overflow: 'hidden',
  }},
  AppModelChoice: { type: 'Pressable', style: {
    padding: 'theme:spaceX5',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
  }},
  AppModelChoiceActive: { type: 'Pressable', style: {
    padding: 'theme:spaceX5',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:accent',
    borderRadius: 'theme:radiusMd',
  }},
  AppModelChoiceText:       { type: 'Text', size: 'theme:typeMeta', color: 'theme:ink',
                              style: { fontFamily: 'theme:fontMono' } },
  AppModelChoiceTextActive: { type: 'Text', size: 'theme:typeMeta', color: 'theme:accent',
                              style: { fontFamily: 'theme:fontMono' } },

  // ── Trait chips (Step3) ─────────────────────────────────────
  AppTraitGrid: { type: 'Box', style: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 'theme:spaceX4',
    justifyContent: 'center',
  }},
  AppTraitChip: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX7', paddingRight: 'theme:spaceX7',
    paddingTop: 'theme:spaceX4', paddingBottom: 'theme:spaceX4',
    borderRadius: 'theme:radiusRound',
    backgroundColor: 'theme:bg1',
    borderWidth: 1, borderColor: 'theme:rule',
  }, variants: {
    light: { style: {
      borderRadius: 'theme:radiusRound',
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRule',
      paddingLeft: 'theme:spaceX8',
      paddingRight: 'theme:spaceX8',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bg',
      borderColor: 'theme:rule',
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
    } },
  }},
  AppTraitChipActive: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX7', paddingRight: 'theme:spaceX7',
    paddingTop: 'theme:spaceX4', paddingBottom: 'theme:spaceX4',
    borderRadius: 'theme:radiusRound',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:accentHot',
  }, variants: {
    light: { style: {
      borderRadius: 'theme:radiusRound',
      backgroundColor: 'theme:accent',
      borderColor: 'theme:accent',
      paddingLeft: 'theme:spaceX8',
      paddingRight: 'theme:spaceX8',
    } },
    dark: { style: {
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bg2',
      borderColor: 'theme:accentHot',
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
    } },
  }},
  AppTraitChipText:       { type: 'Text', size: 'theme:typeMeta', color: 'theme:ink' },
  AppTraitChipTextActive: { type: 'Text', size: 'theme:typeMeta', bold: true, color: 'theme:accentHot' },

  // ── Inline prompt row + hyperlink (Step5) ───────────────────
  // Step5's prompt is "What is your first goal?" with "goal" rendered as a
  // tooltip-bearing hyperlink. The row keeps the segments aligned and the
  // link picks up underline + accent color while staying flush with the
  // surrounding AppPromptText (size 22, bold).
  AppPromptRow: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  }},
  AppPromptLink: { type: 'Pressable', style: { } },
  AppPromptLinkText: { type: 'Text', size: 22, bold: true, color: 'theme:accent',
                       style: { textDecorationLine: 'underline' } },

  // ══════════════════════════════════════════════════════════════
  //   Menu representations — launcher / hub surfaces
  //
  //   Compositional vocabulary for menu tiles. Every menu shape in
  //   `cart/app/gallery/components/menu-*` is built by stacking
  //   these primitives. Each tile is a single artboard surface; the
  //   *form* varies, the entries (cart/app/gallery/data/menu-entry.ts)
  //   stay constant.
  // ══════════════════════════════════════════════════════════════

  // Tile shell — the artboard chrome every menu sits inside. Fixed
  // dimensions so flex:1 children (the stage) actually claim space.
  MenuTile: { type: 'Box', style: {
    flexDirection: 'column',
    width: 560, minWidth: 560,
    height: 420, minHeight: 420,
    flexShrink: 0,
    backgroundColor: 'theme:bg',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusLg',
    overflow: 'hidden',
  }, variants: {
    light: { style: {
      width: 620,
      minWidth: 620,
      height: 470,
      minHeight: 470,
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusXl',
    } },
    dark: { style: {
      width: 520,
      minWidth: 520,
      height: 390,
      minHeight: 390,
      backgroundColor: 'theme:bg',
      borderColor: 'theme:ruleBright',
      borderRadius: 'theme:radiusSm',
    } },
  }},
  MenuTileSquare: { type: 'Box', style: {
    flexDirection: 'column',
    width: 420, minWidth: 420,
    height: 420, minHeight: 420,
    flexShrink: 0,
    backgroundColor: 'theme:bg',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusLg',
    overflow: 'hidden',
  }, variants: {
    light: { style: {
      width: 460,
      minWidth: 460,
      height: 460,
      minHeight: 460,
      backgroundColor: 'theme:paper',
      borderColor: 'theme:paperRule',
      borderRadius: 'theme:radiusXl',
    } },
    dark: { style: {
      width: 390,
      minWidth: 390,
      height: 390,
      minHeight: 390,
      backgroundColor: 'theme:bg',
      borderColor: 'theme:ruleBright',
      borderRadius: 'theme:radiusSm',
    } },
  }},
  MenuTileChrome: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX5',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX4', paddingBottom: 'theme:spaceX4',
    borderBottomWidth: 1, borderBottomColor: 'theme:rule',
    backgroundColor: 'theme:bg1',
    flexShrink: 0,
  }, variants: {
    light: { style: {
      gap: 'theme:spaceX6',
      paddingLeft: 'theme:spaceX7',
      paddingRight: 'theme:spaceX7',
      paddingTop: 'theme:spaceX5',
      paddingBottom: 'theme:spaceX5',
      borderBottomColor: 'theme:paperRule',
      backgroundColor: 'theme:paperAlt',
    } },
    dark: { style: {
      gap: 'theme:spaceX4',
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
      paddingTop: 'theme:spaceX3',
      paddingBottom: 'theme:spaceX3',
      borderBottomColor: 'theme:accentHot',
      backgroundColor: 'theme:bg2',
    } },
  }},
  MenuTileId:    { type: 'Text', size: 'theme:typeBody',  bold: true, color: 'theme:accent',
                   numberOfLines: 1,
                   style: { fontFamily: 'theme:fontMono', letterSpacing: 1.2 } },
  MenuTileTitle: { type: 'Text', size: 'theme:typeBody',  color: 'theme:ink',
                   numberOfLines: 1,
                   style: { fontFamily: 'theme:fontMono', letterSpacing: 1.0 } },
  MenuTileKind:  { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDimmer',
                   numberOfLines: 1,
                   style: { fontFamily: 'theme:fontMono', letterSpacing: 1.4, textTransform: 'uppercase' } },
  MenuTileSpacer: { type: 'Box', style: { flex: 1 }},
  MenuTileStage:  { type: 'Box', style: {
    flexDirection: 'column',
    flex: 1, flexGrow: 1,
    position: 'relative', overflow: 'hidden',
    backgroundColor: 'theme:bg',
  }, variants: {
    light: { style: { backgroundColor: 'theme:paper' } },
    dark: { style: { backgroundColor: 'theme:bg' } },
  }},

  // ── Shared text rungs ────────────────────────────────────────
  // Single-line by default — menu rows live in tight flex contexts where
  // accidental wrapping breaks the artboard. Override per-instance with
  // `numberOfLines={N}` if a specific surface needs wrapping.
  MenuLabel:        { type: 'Text', size: 'theme:typeBase',    color: 'theme:ink',
                      numberOfLines: 1,
                      style: { fontFamily: 'theme:fontMono' } },
  MenuLabelActive:  { type: 'Text', size: 'theme:typeBase',    color: 'theme:accent',
                      numberOfLines: 1,
                      style: { fontFamily: 'theme:fontMono' },
                      variants: {
                        light: { color: 'theme:accent' },
                        dark: { color: 'theme:accentHot' },
                      } },
  MenuLabelStrong:  { type: 'Text', size: 'theme:typeStrong',  color: 'theme:ink',
                      numberOfLines: 1,
                      style: { fontFamily: 'theme:fontMono' } },
  MenuHint:         { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim',
                      numberOfLines: 1,
                      style: { fontFamily: 'theme:fontMono' } },
  MenuHintDim:      { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDimmer',
                      numberOfLines: 1,
                      style: { fontFamily: 'theme:fontMono', letterSpacing: 1.2 } },
  MenuKey:          { type: 'Text', size: 'theme:typeBase',    bold: true, color: 'theme:accentHot',
                      numberOfLines: 1,
                      style: { fontFamily: 'theme:fontMono' } },
  MenuNum:          { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDimmer',
                      numberOfLines: 1,
                      style: { fontFamily: 'theme:fontMono' } },
  MenuNumAccent:    { type: 'Text', size: 'theme:typeCaption', color: 'theme:accent',
                      numberOfLines: 1,
                      style: { fontFamily: 'theme:fontMono', letterSpacing: 1.4 } },
  MenuCaret:        { type: 'Text', size: 'theme:typeBase',    color: 'theme:accent',
                      numberOfLines: 1,
                      style: { fontFamily: 'theme:fontMono' } },

  // Section eyebrow (e.g. "STAGE · 03").
  MenuEyebrow: { type: 'Text', size: 'theme:typeCaption', color: 'theme:accent',
                 numberOfLines: 1,
                 style: { fontFamily: 'theme:fontMono', letterSpacing: 2.4 } },

  // ── A · Lists — basic indent + caret ─────────────────────────
  MenuListBox: { type: 'Box', style: {
    paddingLeft: 'theme:spaceX7', paddingRight: 'theme:spaceX7',
    paddingTop: 'theme:spaceX6', paddingBottom: 'theme:spaceX6',
    gap: 'theme:spaceX1',
  }, variants: {
    light: { style: {
      paddingLeft: 'theme:spaceX8',
      paddingRight: 'theme:spaceX8',
      paddingTop: 'theme:spaceX7',
      paddingBottom: 'theme:spaceX7',
      gap: 'theme:spaceX2',
    } },
    dark: { style: {
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
      paddingTop: 'theme:spaceX4',
      paddingBottom: 'theme:spaceX4',
      gap: 'theme:spaceX0',
    } },
  }},
  MenuListRow: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX5',
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
    borderRadius: 'theme:radiusSm',
  }, variants: {
    light: { style: {
      gap: 'theme:spaceX6',
      paddingLeft: 'theme:spaceX5',
      paddingRight: 'theme:spaceX5',
      paddingTop: 'theme:spaceX4',
      paddingBottom: 'theme:spaceX4',
      borderRadius: 'theme:radiusRound',
    } },
    dark: { style: {
      gap: 'theme:spaceX3',
      paddingLeft: 'theme:spaceX3',
      paddingRight: 'theme:spaceX3',
      paddingTop: 'theme:spaceX2',
      paddingBottom: 'theme:spaceX2',
      borderRadius: 'theme:radiusSm',
    } },
  }},
  MenuListRowActive: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX5',
    paddingLeft: 'theme:spaceX7', paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
    backgroundColor: 'theme:bg2',
    borderRadius: 'theme:radiusSm',
  }, variants: {
    light: { style: {
      gap: 'theme:spaceX6',
      paddingLeft: 'theme:spaceX7',
      paddingRight: 'theme:spaceX5',
      paddingTop: 'theme:spaceX4',
      paddingBottom: 'theme:spaceX4',
      backgroundColor: 'theme:paperAlt',
      borderRadius: 'theme:radiusRound',
    } },
    dark: { style: {
      gap: 'theme:spaceX3',
      paddingLeft: 'theme:spaceX4',
      paddingRight: 'theme:spaceX3',
      paddingTop: 'theme:spaceX2',
      paddingBottom: 'theme:spaceX2',
      backgroundColor: 'theme:bg2',
      borderRadius: 'theme:radiusSm',
      borderWidth: 1,
      borderColor: 'theme:accentHot',
    } },
  }},
  MenuListLabelCol: { type: 'Box', style: { flex: 1 }},

  // A3 keyed list rows (single keycap + label, hover spreads gap)
  MenuKeyedRow: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX6',
    paddingLeft: 'theme:spaceX2', paddingRight: 'theme:spaceX2',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
  }},
  MenuKeyedRowActive: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX8',
    paddingLeft: 'theme:spaceX2', paddingRight: 'theme:spaceX2',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
  }},

  // A5 sliding marker
  MenuMarkerBox: { type: 'Box', style: {
    position: 'relative',
    paddingLeft: 'theme:spaceX7', paddingRight: 'theme:spaceX7',
    paddingTop: 'theme:spaceX6', paddingBottom: 'theme:spaceX6',
  }},
  MenuMarkerSlab: { type: 'Box', style: {
    position: 'absolute',
    left: 8, right: 8,
    height: 28,
    backgroundColor: 'theme:bg2',
    borderLeftWidth: 2, borderLeftColor: 'theme:accent',
  }},
  MenuMarkerRow: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
    gap: 'theme:spaceX5',
  }},

  // ── B · Radials — fan blade body (surface around an SVG Graph) ──
  MenuRadialBox: { type: 'Box', style: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 'theme:spaceX5',
  }},
  MenuRadialCenter: { type: 'Box', style: {
    position: 'absolute',
    alignItems: 'center', justifyContent: 'center',
    gap: 'theme:spaceX1',
  }},

  // ── C · Grids ────────────────────────────────────────────────
  MenuGridBox: { type: 'Box', style: {
    flex: 1,
    padding: 'theme:spaceX6',
    gap: 'theme:spaceX5',
  }},
  MenuGridRow: { type: 'Box', style: { flexDirection: 'row',
    flex: 1,
    gap: 'theme:spaceX5',
  }},
  MenuGridTile: { type: 'Pressable', style: {
    flex: 1,
    padding: 'theme:spaceX5',
    borderWidth: 1, borderColor: 'theme:rule',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg',
    justifyContent: 'space-between',
    gap: 'theme:spaceX2',
  }},
  MenuGridTileActive: { type: 'Pressable', style: {
    flex: 1,
    padding: 'theme:spaceX5',
    borderWidth: 1, borderColor: 'theme:accentHot',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg1',
    justifyContent: 'space-between',
    gap: 'theme:spaceX2',
  }},

  // C3 brick row (offset every other) — uses flex-grow to bloom on active
  MenuBrickRow: { type: 'Box', style: { flexDirection: 'row',
    flex: 1,
    gap: 'theme:spaceX2',
  }},
  MenuBrickRowOffset: { type: 'Box', style: { flexDirection: 'row',
    flex: 1,
    gap: 'theme:spaceX2',
    paddingLeft: 'theme:spaceX8',
  }},
  MenuBrick: { type: 'Pressable', style: {
    flex: 1,
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    alignItems: 'flex-start', justifyContent: 'center',
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg',
  }},
  MenuBrickActive: { type: 'Pressable', style: {
    flex: 2,
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    alignItems: 'flex-start', justifyContent: 'center',
    borderWidth: 1, borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg2',
  }},

  // ── D · Rails ────────────────────────────────────────────────
  // D1 left rail
  MenuSpine: { type: 'Box', style: { flexDirection: 'row', flex: 1 }},
  MenuRail: { type: 'Box', style: {
    width: 56,
    borderRightWidth: 1, borderRightColor: 'theme:rule',
  }},
  MenuRailBtn: { type: 'Pressable', style: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 1, borderBottomColor: 'theme:rule',
    backgroundColor: 'theme:bg',
  }},
  MenuRailBtnActive: { type: 'Pressable', style: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 1, borderBottomColor: 'theme:rule',
    borderLeftWidth: 3, borderLeftColor: 'theme:accentHot',
    backgroundColor: 'theme:bg1',
  }},
  MenuPreview: { type: 'Box', style: {
    flex: 1,
    padding: 'theme:spaceX8',
    gap: 'theme:spaceX4',
  }},
  MenuPreviewTitle: { type: 'Text', size: 'theme:typeHeading', bold: true, color: 'theme:ink',
                      numberOfLines: 1,
                      style: { letterSpacing: -0.4 } },

  // D2 ribbon
  MenuRibbon: { type: 'Box', style: { flexDirection: 'column', flex: 1 }},
  MenuRibbonTabs: { type: 'Box', style: { flexDirection: 'row',
    height: 36,
    borderBottomWidth: 1, borderBottomColor: 'theme:rule',
  }},
  MenuRibbonTab: { type: 'Pressable', style: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRightWidth: 1, borderRightColor: 'theme:rule',
  }},
  MenuRibbonTabActive: { type: 'Pressable', style: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    borderRightWidth: 1, borderRightColor: 'theme:rule',
    borderBottomWidth: 2, borderBottomColor: 'theme:accentHot',
    backgroundColor: 'theme:bg1',
  }},
  MenuRibbonBody: { type: 'Box', style: {
    flex: 1, padding: 'theme:spaceX8', gap: 'theme:spaceX4',
  }},

  // D3 dock
  MenuDock: { type: 'Box', style: { flexDirection: 'column', flex: 1 }},
  MenuDockStage: { type: 'Box', style: {
    flex: 1, padding: 'theme:spaceX8', gap: 'theme:spaceX2',
  }},
  MenuDockBar: { type: 'Box', style: { flexDirection: 'row',
    height: 56,
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
    gap: 'theme:spaceX3',
    borderTopWidth: 1, borderTopColor: 'theme:rule',
  }},
  MenuDockBtn: { type: 'Pressable', style: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 'theme:radiusSm',
    gap: 'theme:spaceX1',
  }},
  MenuDockBtnActive: { type: 'Pressable', style: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
    gap: 'theme:spaceX1',
  }},
  MenuDockGlyph: { type: 'Text', size: 'theme:typeHeading', color: 'theme:inkDim',
                   numberOfLines: 1,
                   style: { fontFamily: 'theme:fontMono' } },
  MenuDockGlyphActive: { type: 'Text', size: 'theme:typeHeading', color: 'theme:accent',
                         numberOfLines: 1,
                         style: { fontFamily: 'theme:fontMono' } },

  // D4 marquee strip
  MenuMarquee: { type: 'Box', style: {
    flex: 1, padding: 'theme:spaceX8', gap: 'theme:spaceX3',
  }},
  MenuMarqueeTrack: { type: 'Box', style: {
    height: 32,
    position: 'relative',
    borderTopWidth: 1, borderTopColor: 'theme:rule',
    borderBottomWidth: 1, borderBottomColor: 'theme:rule',
    overflow: 'hidden',
  }},
  MenuMarqueeStrip: { type: 'Box', style: { flexDirection: 'row',
    position: 'absolute',
    top: 0, bottom: 0,
    alignItems: 'center',
  }},
  MenuMarqueeItem: { type: 'Pressable', style: { flexDirection: 'row',
    width: 160,
    height: 30,
    gap: 'theme:spaceX2',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
  }},

  // ── E · Cards ────────────────────────────────────────────────
  // E1 dossier (absolute layout)
  MenuDossier: { type: 'Box', style: {
    flex: 1, position: 'relative', padding: 'theme:spaceX7',
  }},
  MenuDossierCard: { type: 'Pressable', style: {
    width: 270, height: 168,
    backgroundColor: 'theme:bg1',
    borderWidth: 1, borderColor: 'theme:ruleBright',
    padding: 'theme:spaceX6',
    justifyContent: 'space-between',
  }},
  MenuDossierCardActive: { type: 'Pressable', style: {
    width: 270, height: 168,
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:accent',
    padding: 'theme:spaceX6',
    justifyContent: 'space-between',
  }},
  MenuDossierTitle: { type: 'Text', size: 'theme:typeHeading', color: 'theme:ink', numberOfLines: 1 },

  // E2 file folder
  MenuFolder: { type: 'Box', style: {
    flex: 1, flexDirection: 'column',
    padding: 'theme:spaceX5',
  }},
  MenuFolderTabs: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'flex-end',
    height: 36,
    gap: 1,
  }},
  MenuFolderTab: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX4', paddingBottom: 'theme:spaceX3',
    backgroundColor: 'theme:bg1',
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: 'theme:rule',
    borderTopLeftRadius: 'theme:radiusSm', borderTopRightRadius: 'theme:radiusSm',
  }},
  MenuFolderTabActive: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX7', paddingRight: 'theme:spaceX7',
    paddingTop: 'theme:spaceX5', paddingBottom: 'theme:spaceX3',
    backgroundColor: 'theme:bg2',
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: 'theme:ruleBright',
    borderTopLeftRadius: 'theme:radiusSm', borderTopRightRadius: 'theme:radiusSm',
  }},
  MenuFolderBody: { type: 'Box', style: {
    flex: 1,
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:ruleBright',
    padding: 'theme:spaceX8',
    gap: 'theme:spaceX4',
  }},

  // ── F · Diagrams ─────────────────────────────────────────────
  MenuCli: { type: 'Box', style: {
    flex: 1,
    padding: 'theme:spaceX8',
    gap: 'theme:spaceX2',
  }},
  MenuCliPrompt: { type: 'Text', size: 'theme:typeBase', color: 'theme:accentHot',
                   style: { fontFamily: 'theme:fontMono' } },
  MenuCliBranch: { type: 'Pressable', style: { flexDirection: 'row',
    gap: 'theme:spaceX3',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
  }},
  MenuCliGlyph: { type: 'Text', size: 'theme:typeBase', color: 'theme:inkDimmer',
                  style: { fontFamily: 'theme:fontMono' } },
  MenuCliHint:  { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim',
                  style: { fontFamily: 'theme:fontMono', marginLeft: 8 } },

  // ── G · Spatial / diegetic ───────────────────────────────────
  // G1 depth tiers (transformed rows)
  MenuDepth: { type: 'Box', style: {
    flex: 1, padding: 'theme:spaceX7',
    gap: 'theme:spaceX3',
  }},
  MenuDepthRow: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX5',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
  }},
  MenuDepthRowActive: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX5',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    paddingLeft: 'theme:spaceX7',
  }},
  MenuDisplayLabel:        { type: 'Text', size: 'theme:typeStrong', color: 'theme:inkDim', numberOfLines: 1 },
  MenuDisplayLabelActive:  { type: 'Text', size: 'theme:typeStrong', bold: true, color: 'theme:accentHot', numberOfLines: 1 },

  // G2 terminal
  MenuTerm: { type: 'Box', style: {
    flex: 1,
    padding: 'theme:spaceX7',
    gap: 'theme:spaceX2',
    backgroundColor: 'theme:bg',
  }},
  MenuTermLine:    { type: 'Text', size: 'theme:typeBase', color: 'theme:inkDim',
                     style: { fontFamily: 'theme:fontMono' } },
  MenuTermLineOk:  { type: 'Text', size: 'theme:typeBase', color: 'theme:ok',
                     style: { fontFamily: 'theme:fontMono' } },
  MenuTermPrompt:  { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX1',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
  }},
  MenuTermCursor:  { type: 'Box', style: {
    width: 8, height: 14,
    backgroundColor: 'theme:accentHot',
  }},
  MenuTermOpt: { type: 'Pressable', style: { flexDirection: 'row',
    gap: 'theme:spaceX5',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
  }},
  MenuTermOptActive: { type: 'Pressable', style: { flexDirection: 'row',
    gap: 'theme:spaceX5',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
  }},

  // G3 console panel
  MenuConsole: { type: 'Box', style: {
    flex: 1,
    padding: 'theme:spaceX6',
    gap: 'theme:spaceX4',
  }},
  MenuConsoleRow: { type: 'Box', style: { flexDirection: 'row',
    flex: 1, gap: 'theme:spaceX4',
  }},
  MenuConsoleCell: { type: 'Pressable', style: {
    flex: 1,
    padding: 'theme:spaceX5',
    borderWidth: 1, borderColor: 'theme:ruleBright',
    backgroundColor: 'theme:bg1',
    justifyContent: 'space-between',
    gap: 'theme:spaceX3',
  }},
  MenuConsoleCellActive: { type: 'Pressable', style: {
    flex: 1,
    padding: 'theme:spaceX5',
    borderWidth: 1, borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg2',
    justifyContent: 'space-between',
    gap: 'theme:spaceX3',
  }},
  MenuConsoleHead: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center', gap: 'theme:spaceX4',
  }},
  MenuLed:        { type: 'Box', style: {
    width: 8, height: 8, borderRadius: 'theme:radiusPill',
    backgroundColor: 'theme:inkDimmer',
  }},
  MenuLedActive:  { type: 'Box', style: {
    width: 8, height: 8, borderRadius: 'theme:radiusPill',
    backgroundColor: 'theme:accentHot',
  }},

  // G4 curtain
  MenuCurtain: { type: 'Box', style: { flex: 1, flexDirection: 'column' }},
  MenuCurtainRow: { type: 'Pressable', style: { flexDirection: 'row',
    flex: 1,
    alignItems: 'center',
    gap: 'theme:spaceX5',
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    borderBottomWidth: 1, borderBottomColor: 'theme:rule',
    backgroundColor: 'theme:bg',
  }},
  MenuCurtainRowActive: { type: 'Pressable', style: { flexDirection: 'row',
    flex: 3,
    alignItems: 'center',
    gap: 'theme:spaceX5',
    paddingLeft: 'theme:spaceX8', paddingRight: 'theme:spaceX8',
    borderBottomWidth: 1, borderBottomColor: 'theme:rule',
    backgroundColor: 'theme:bg2',
  }},
  MenuCurtainSpacer: { type: 'Box', style: { flex: 1 }},

  // ── H · Weird ────────────────────────────────────────────────
  // H2 barcode
  MenuBarcode: { type: 'Box', style: {
    flex: 1, padding: 'theme:spaceX6',
    gap: 'theme:spaceX5',
  }},
  MenuBarcodeStrip: { type: 'Box', style: { flexDirection: 'row',
    flex: 1, gap: 2, alignItems: 'stretch',
  }},
  MenuBarcodeBar: { type: 'Pressable', style: {
    flex: 1,
    backgroundColor: 'theme:ink',
    paddingLeft: 'theme:spaceX2', paddingRight: 'theme:spaceX2',
    paddingBottom: 'theme:spaceX5',
    justifyContent: 'flex-end',
  }},
  MenuBarcodeBarActive: { type: 'Pressable', style: {
    flex: 4,
    backgroundColor: 'theme:accentHot',
    paddingLeft: 'theme:spaceX2', paddingRight: 'theme:spaceX2',
    paddingBottom: 'theme:spaceX5',
    justifyContent: 'flex-end',
  }},
  MenuBarcodeLabel:       { type: 'Text', size: 'theme:typeMicro', color: 'theme:bg',
                            numberOfLines: 1,
                            style: { fontFamily: 'theme:fontMono', letterSpacing: 1.6 } },
  MenuBarcodeLabelActive: { type: 'Text', size: 'theme:typeMicro', color: 'theme:ink',
                            numberOfLines: 1,
                            style: { fontFamily: 'theme:fontMono', letterSpacing: 1.6 } },
  MenuBarcodeFoot: { type: 'Box', style: { flexDirection: 'row',
    justifyContent: 'space-between',
  }},

  // H3 periodic — square 1:1 surface, periodic-table silhouette of cards
  MenuPeriodic: { type: 'Box', style: {
    flex: 1,
    flexDirection: 'column',
    paddingTop: 'theme:spaceX6', paddingBottom: 'theme:spaceX6',
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
    gap: 'theme:spaceX5',
  }},
  MenuPeriodicGroupRow: { type: 'Box', style: { flexDirection: 'row',
    paddingLeft: 18,
    gap: 4,
  }},
  MenuPeriodicGroupTick: { type: 'Box', style: {
    width: 50, alignItems: 'center',
  }},
  MenuPeriodicTable: { type: 'Box', style: { flexDirection: 'column',
    flex: 1,
    gap: 4,
  }},
  MenuPeriodicTableRow: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  }},
  MenuPeriodicPeriodTick: { type: 'Box', style: {
    width: 14,
    alignItems: 'center',
  }},
  MenuPeriodicEmpty: { type: 'Box', style: {
    width: 50, height: 56,
    alignItems: 'center', justifyContent: 'center',
  }},
  MenuPeriodicEmptyDot: { type: 'Box', style: {
    width: 3, height: 3,
    borderRadius: 'theme:radiusPill',
    backgroundColor: 'theme:rule',
  }},
  MenuPeriodicCellLive: { type: 'Pressable', style: {
    width: 50, height: 56,
    borderWidth: 1, borderColor: 'theme:ruleBright',
    backgroundColor: 'theme:bg1',
    paddingLeft: 4, paddingRight: 4,
    paddingTop: 4, paddingBottom: 4,
    justifyContent: 'space-between',
  }},
  MenuPeriodicCellActive: { type: 'Pressable', style: {
    width: 50, height: 56,
    borderWidth: 1, borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg2',
    paddingLeft: 4, paddingRight: 4,
    paddingTop: 4, paddingBottom: 4,
    justifyContent: 'space-between',
  }},
  MenuPeriodicCellHead: { type: 'Box', style: { flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  }},
  MenuPeriodicSym: { type: 'Text', size: 22, bold: true, color: 'theme:ink',
                     style: { fontFamily: 'theme:fontMono', textAlign: 'center', lineHeight: 22 } },
  MenuPeriodicSymActive: { type: 'Text', size: 22, bold: true, color: 'theme:accentHot',
                           style: { fontFamily: 'theme:fontMono', textAlign: 'center', lineHeight: 22 } },
  MenuPeriodicSymRow: { type: 'Box', style: { flex: 1, alignItems: 'center', justifyContent: 'center' }},
  MenuPeriodicNum:    { type: 'Text', size: 'theme:typeMicro', color: 'theme:accent',
                        style: { fontFamily: 'theme:fontMono' } },
  MenuPeriodicMass:   { type: 'Text', size: 'theme:typeMicro', color: 'theme:inkDimmer',
                        style: { fontFamily: 'theme:fontMono' } },
  MenuPeriodicName:   { type: 'Text', size: 6, color: 'theme:inkDim',
                        style: { fontFamily: 'theme:fontMono', letterSpacing: 1.0, textAlign: 'center' } },
  MenuPeriodicNameActive: { type: 'Text', size: 6, color: 'theme:ink',
                            style: { fontFamily: 'theme:fontMono', letterSpacing: 1.0, textAlign: 'center' } },
  MenuPeriodicGroupNum: { type: 'Text', size: 'theme:typeMicro', color: 'theme:inkDimmer',
                          style: { fontFamily: 'theme:fontMono', letterSpacing: 1.4 } },
  MenuPeriodicPeriodNum: { type: 'Text', size: 'theme:typeMicro', color: 'theme:inkDimmer',
                           style: { fontFamily: 'theme:fontMono', letterSpacing: 1.4 } },

  // H3 featured-element strip (the popout below the table)
  MenuPeriodicFeature: { type: 'Box', style: { flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX6',
    borderTopWidth: 1, borderTopColor: 'theme:rule',
    paddingTop: 'theme:spaceX5',
  }},
  MenuPeriodicFeatureSym: { type: 'Box', style: {
    width: 56, height: 64,
    borderWidth: 1, borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg2',
    paddingLeft: 5, paddingRight: 5,
    paddingTop: 5, paddingBottom: 5,
    justifyContent: 'space-between',
  }},
  MenuPeriodicFeatureMain: { type: 'Box', style: { flex: 1,
    gap: 2,
  }},

  // H5 type-as-menu
  MenuTypeStack: { type: 'Box', style: {
    flex: 1, padding: 'theme:spaceX8',
    gap: 'theme:spaceX2',
  }},
  MenuTypeStackBody: { type: 'Box', style: {
    flex: 1, justifyContent: 'center',
  }},
  MenuTypeRow: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center', gap: 'theme:spaceX5',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
  }},
  MenuTypeRowActive: { type: 'Pressable', style: { flexDirection: 'row',
    alignItems: 'center', gap: 'theme:spaceX5',
    paddingLeft: 'theme:spaceX7',
    paddingTop: 'theme:spaceX1', paddingBottom: 'theme:spaceX1',
  }},
  MenuTypeBar: { type: 'Box', style: {
    width: 16, height: 1, backgroundColor: 'theme:accentHot',
  }},
  MenuTypeText:        { type: 'Text', size: 'theme:typeStrong', color: 'theme:inkDimmer',
                         numberOfLines: 1,
                         style: { letterSpacing: -0.4 } },
  MenuTypeTextActive:  { type: 'Text', size: 'theme:typeHeading', bold: true, color: 'theme:ink',
                         numberOfLines: 1,
                         style: { letterSpacing: -0.4 } },
  MenuTypeHint: { type: 'Text', size: 'theme:typeBase', color: 'theme:accent',
                  numberOfLines: 1,
                  style: { fontFamily: 'theme:fontMono', letterSpacing: 1.2 } },

  // ── Common atoms used across multiple menus ──────────────────
  MenuStatusDotLive: { type: 'Box', style: {
    width: 6, height: 6, borderRadius: 'theme:radiusPill',
    backgroundColor: 'theme:ok',
  }},
  MenuStatusDotWarn: { type: 'Box', style: {
    width: 6, height: 6, borderRadius: 'theme:radiusPill',
    backgroundColor: 'theme:warn',
  }},
  MenuStatusDotMute: { type: 'Box', style: {
    width: 6, height: 6, borderRadius: 'theme:radiusPill',
    backgroundColor: 'theme:inkDimmer',
  }},

  // ──────────────────────────────────────────────────────────────
  //   Input slot containers — morph-driven layout
  // ──────────────────────────────────────────────────────────────
  //
  // Two slot containers wrap the persistent <InputStrip> in cart/app.
  // The cart drives their dimensions per render via local style
  // overrides (paddingRight on BottomInputBar; width on SideMenuInput;
  // height on BottomInputBar) so the layout can interpolate smoothly
  // instead of snapping via display:none.
  //
  // Variant ('side' vs null) controls input PLACEMENT only — JSX
  // conditional renders the input inside whichever container's natural
  // home it currently is. Visibility is purely a function of the
  // morph values applied as inline styles.
  AppBottomInputBar: { type: 'Box', style: {
    width: '100%',
    flexShrink: 0,
    overflow: 'hidden',
    flexDirection: 'column',
    backgroundColor: 'theme:bg',
  }},

  AppSideMenuInput: { type: 'Box', style: {
    width: 0,
    height: '100%',
    flexShrink: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    // Match the page bg so there's no visible color split where the
    // side menu meets the rest of the app. Once menu items land, they
    // can carry their own surfaces.
    backgroundColor: 'theme:bg',
    justifyContent: 'flex-end',
  }},

  // ══════════════════════════════════════════════════════════════
  //   Manifest Gate (cart/manifest_gate/index.tsx) — Round-2 of the
  //   line-manifest benchmark. All theme-touching styling lives here;
  //   per-render values (spring opacity, slide y, pulse-driven sizes)
  //   flow as inline style overrides at the call sites.
  // ══════════════════════════════════════════════════════════════

  ManifestGateRoot: { type: 'Box', style: {
    width: '100%', height: '100%',
    backgroundColor: 'theme:bg',
    flexDirection: 'column',
  }},
  ManifestGateChrome: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX5', paddingBottom: 'theme:spaceX5',
    backgroundColor: 'theme:bg1',
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
  }},
  ManifestGateChromeTitle:    { type: 'Text', size: 'theme:typeHeading', bold: true, color: 'theme:ink' },
  ManifestGateChromeSubtitle: { type: 'Text', size: 'theme:typeMeta', color: 'theme:inkDim' },
  ManifestGateChromeStatusCol: { type: 'Box', style: {
    flexDirection: 'column', alignItems: 'flex-end', gap: 'theme:spaceX1',
  }},
  ManifestGateChromeStatusRow: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center', gap: 'theme:spaceX3',
  }},
  ManifestGatePhaseLabel: { type: 'Text', size: 'theme:typeMeta', bold: true, color: 'theme:ink' },
  ManifestGatePhaseMeta:  { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },

  // Status-dot variants — discrete classifier per phase color so the
  // theme owns the palette. JSX picks one based on phase.
  ManifestGateStatusDotIdle:       { type: 'Box', style: { borderRadius: 'theme:radiusRound', backgroundColor: 'theme:inkDim' } },
  ManifestGateStatusDotLoading:    { type: 'Box', style: { borderRadius: 'theme:radiusRound', backgroundColor: 'theme:warn' } },
  ManifestGateStatusDotLoaded:     { type: 'Box', style: { borderRadius: 'theme:radiusRound', backgroundColor: 'theme:ok' } },
  ManifestGateStatusDotGenerating: { type: 'Box', style: { borderRadius: 'theme:radiusRound', backgroundColor: 'theme:accent' } },
  ManifestGateStatusDotFailed:     { type: 'Box', style: { borderRadius: 'theme:radiusRound', backgroundColor: 'theme:flag' } },

  // Body region (everything below the chrome).
  ManifestGateBody: { type: 'Box', style: {
    flexGrow: 1,
    paddingLeft: 'theme:spaceX7', paddingRight: 'theme:spaceX7',
    paddingTop: 'theme:spaceX6', paddingBottom: 'theme:spaceX6',
    gap: 'theme:spaceX5',
    flexDirection: 'column',
  }},

  ManifestGatePanel: { type: 'Box', style: {
    backgroundColor: 'theme:bg1',
    borderWidth: 1,
    borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX5', paddingBottom: 'theme:spaceX5',
    gap: 'theme:spaceX4',
    flexDirection: 'column',
  }},
  ManifestGatePanelGrow: { type: 'Box', style: {
    backgroundColor: 'theme:bg1',
    borderWidth: 1,
    borderColor: 'theme:rule',
    borderRadius: 'theme:radiusMd',
    paddingLeft: 'theme:spaceX6', paddingRight: 'theme:spaceX6',
    paddingTop: 'theme:spaceX5', paddingBottom: 'theme:spaceX5',
    gap: 'theme:spaceX4',
    flexDirection: 'column',
    flexGrow: 1, minHeight: 0,
  }},
  ManifestGatePanelHeader: { type: 'Box', style: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  }},
  ManifestGatePanelTitle:    { type: 'Text', size: 'theme:typeBase', bold: true, color: 'theme:ink' },
  ManifestGatePanelHint:     { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },
  ManifestGatePanelHintMono: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim', font: 'theme:fontMono' },

  // Verdict count badges — separate classifiers, picked by JSX.
  ManifestGateCountTrue:    { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:ok' },
  ManifestGateCountFalse:   { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:flag' },
  ManifestGateCountUnclear: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:warn' },
  ManifestGateCountElapsed: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },

  // Run button: active vs disabled (separate classifiers, no inline color
  // logic — JSX picks based on (ready && !running)).
  ManifestGateRunBtn: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:accent',
    alignItems: 'center', justifyContent: 'center',
  }},
  ManifestGateRunBtnDisabled: { type: 'Pressable', style: {
    paddingLeft: 'theme:spaceX5', paddingRight: 'theme:spaceX5',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
    alignItems: 'center', justifyContent: 'center',
  }},
  ManifestGateRunBtnLabel:         { type: 'Text', size: 'theme:typeBase', bold: true, color: 'theme:ink' },
  ManifestGateRunBtnLabelDisabled: { type: 'Text', size: 'theme:typeBase', bold: true, color: 'theme:inkDim' },

  // Stream panel — heartbeat sparkline cells + the live token line.
  ManifestGateStreamSubtitle: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },
  ManifestGateStreamCells: { type: 'Box', style: {
    flexDirection: 'row', gap: 'theme:spaceX1',
  }},
  ManifestGateStreamCellOff: { type: 'Box', style: {
    width: 6, height: 12, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:bg2',
  }},
  ManifestGateStreamCellOn: { type: 'Box', style: {
    width: 6, height: 12, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:accent',
  }},
  ManifestGateStreamClaim: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },
  ManifestGateStreamBox: { type: 'Box', style: {
    backgroundColor: 'theme:bg2',
    borderRadius: 'theme:radiusSm',
    paddingLeft: 'theme:spaceX4', paddingRight: 'theme:spaceX4',
    paddingTop: 'theme:spaceX3', paddingBottom: 'theme:spaceX3',
    minHeight: 28,
  }},
  ManifestGateStreamText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:accent', font: 'theme:fontMono' },
  ManifestGateStreamPlaceholder: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim', font: 'theme:fontMono' },

  // Verdict row — idle vs active (active gets a continuous border-flow
  // trace; the GenericCardShell pattern from list_lab "border" scene).
  ManifestGateVerdictRow: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX3',
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:rule',
  }},
  ManifestGateVerdictRowActive: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'theme:spaceX3',
    paddingLeft: 'theme:spaceX3', paddingRight: 'theme:spaceX3',
    paddingTop: 'theme:spaceX2', paddingBottom: 'theme:spaceX2',
    borderRadius: 'theme:radiusSm',
    backgroundColor: 'theme:bg2',
    borderWidth: 1, borderColor: 'theme:accent',
    borderDashOn: 6, borderDashOff: 4, borderDashWidth: 1,
    borderFlowSpeed: 24,
  }},

  // Verdict badge — discrete classifier per state (no inline color picks).
  ManifestGateBadgeTrue:    { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:ok',     font: 'theme:fontMono' },
  ManifestGateBadgeFalse:   { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:flag',   font: 'theme:fontMono' },
  ManifestGateBadgePending: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:warn',   font: 'theme:fontMono' },
  ManifestGateBadgeUnclear: { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:warn',   font: 'theme:fontMono' },
  ManifestGateBadgeIdle:    { type: 'Text', size: 'theme:typeCaption', bold: true, color: 'theme:inkDim', font: 'theme:fontMono' },

  ManifestGateBadgeSlot: { type: 'Box', style: { width: 64, alignItems: 'center' } },
  ManifestGateLineSlot:  { type: 'Box', style: { width: 40 } },
  ManifestGateLineLabel: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim', font: 'theme:fontMono' },
  ManifestGateClaimSlot: { type: 'Box', style: { flexGrow: 1 } },
  ManifestGateClaimText: { type: 'Text', size: 'theme:typeCaption', color: 'theme:ink' },

  ManifestGateEmpty: { type: 'Text', size: 'theme:typeCaption', color: 'theme:inkDim' },

  // ──────────────────────────────────────────────────────────────
  //   Persistent assistant chat (full ↔ side fluid surface)
  // ──────────────────────────────────────────────────────────────
  //
  // The supervisor chat renders above the InputStrip in two shapes:
  //   - 'side' — pinned inside AppSideMenuInput, above the docked
  //              InputStrip (state B = activity-docked)
  //   - 'full' — fills the activity content area, above the bottom
  //              InputStrip bar (state C = activity-focal)
  // Same component, two slots; thread state lives in cart/app/chat/store.
  // The morph itself is a fade — geometry rides the InputStrip GOLDEN
  // morph; the chat panel renders into whichever slot is winning.

  AppChatPanel: { type: 'Box', style: {
    width: '100%',
    flexGrow: 1,
    minHeight: 0,
    flexDirection: 'column',
    backgroundColor: 'theme:bg',
    borderWidth: 1,
    borderColor: 'theme:accentHot',
    overflow: 'hidden',
  }},

  AppChatPanelHeader: { type: 'Box', style: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 36,
    paddingLeft: 12, paddingRight: 8,
    borderBottomWidth: 1,
    borderColor: 'theme:rule',
    gap: 8,
    backgroundColor: 'theme:bg1',
    flexShrink: 0,
  }},

  AppChatPanelHeaderLeft: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  }},

  AppChatPanelHeaderDot: { type: 'Box', style: {
    width: 8, height: 8, borderRadius: 'theme:radiusPill',
    backgroundColor: 'theme:accent',
  }},

  AppChatPanelHeaderTitle: { type: 'Text', size: 11, bold: true, color: 'theme:ink',
                             style: { fontFamily: 'theme:fontMono', letterSpacing: 3, lineHeight: 13, whiteSpace: 'pre' } },

  AppChatPanelHeaderState: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    height: 18, paddingLeft: 6, paddingRight: 6,
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg2',
  }},

  AppChatPanelHeaderStateText: { type: 'Text', size: 9, bold: true, color: 'theme:inkDim',
                                  style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },

  AppChatPanelHeaderToggle: { type: 'Pressable', style: {
    width: 24, height: 24,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg2',
  }},

  AppChatPanelHeaderToggleText: { type: 'Text', size: 12, bold: true, color: 'theme:ink',
                                   style: { fontFamily: 'theme:fontMono', lineHeight: 14, whiteSpace: 'pre' } },

  AppChatPanelSubline: { type: 'Box', style: {
    paddingLeft: 12, paddingRight: 12,
    paddingTop: 6, paddingBottom: 6,
    borderBottomWidth: 1, borderColor: 'theme:rule',
    flexShrink: 0,
  }},

  AppChatPanelSublineText: { type: 'Text', size: 9, color: 'theme:inkDimmer',
                              style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },

  AppChatTranscript: { type: 'Box', style: {
    flexGrow: 1,
    minHeight: 0,
    flexDirection: 'column',
    paddingLeft: 14, paddingRight: 14,
    paddingTop: 14, paddingBottom: 14,
    gap: 14,
    overflow: 'scroll',
  }},

  // ── Shelve handle ────────────────────────────────────────────────
  // Thin bar that replaces the InputStrip when the user shelves the
  // input (Ctrl+\). Click to restore. Anchored to the bottom of the
  // page area; left edge spans the full viewport so it's reachable
  // even when the side rail is wide.

  AppShelveHandle: { type: 'Pressable', style: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'theme:bg1',
    borderTopWidth: 1,
    borderColor: 'theme:rule',
  }},

  AppShelveHandleLabel: { type: 'Text', size: 10, color: 'theme:inkDim',
                          style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 12, whiteSpace: 'pre' } },

  AppShelveHandleKbd: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    height: 16, paddingLeft: 5, paddingRight: 5,
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg2',
  }},

  AppShelveHandleKbdText: { type: 'Text', size: 9, color: 'theme:inkDimmer',
                            style: { fontFamily: 'theme:fontMono', letterSpacing: 1, lineHeight: 11, whiteSpace: 'pre' } },

  // Chat-history list (rail's chat slot when no live session, OR when on
  // /chat and the live transcript is in the activity area).
  AppChatHistoryList: { type: 'Box', style: {
    flexDirection: 'column',
    gap: 4,
    paddingTop: 8, paddingBottom: 8,
    paddingLeft: 6, paddingRight: 6,
  }},

  AppChatHistoryRow: { type: 'Pressable', style: {
    flexDirection: 'column',
    gap: 2,
    paddingTop: 8, paddingBottom: 8,
    paddingLeft: 10, paddingRight: 10,
    borderLeftWidth: 2,
    borderColor: 'theme:rule',
    backgroundColor: 'theme:bg1',
  }},

  AppChatHistoryRowActive: { type: 'Pressable', style: {
    flexDirection: 'column',
    gap: 2,
    paddingTop: 8, paddingBottom: 8,
    paddingLeft: 10, paddingRight: 10,
    borderLeftWidth: 2,
    borderColor: 'theme:accent',
    backgroundColor: 'theme:bg2',
  }},

  AppChatHistoryRowTitle: { type: 'Text', size: 12, color: 'theme:ink',
                            style: { fontFamily: 'theme:fontSans', lineHeight: 16 } },

  AppChatHistoryRowMeta: { type: 'Text', size: 9, color: 'theme:inkDimmer',
                           style: { fontFamily: 'theme:fontMono', letterSpacing: 1, lineHeight: 11, whiteSpace: 'pre' } },

  AppChatHistoryEmpty: { type: 'Box', style: {
    paddingTop: 20, paddingBottom: 20,
    paddingLeft: 14, paddingRight: 14,
    flexDirection: 'column',
    gap: 6,
  }},

  AppChatHistoryEmptyText: { type: 'Text', size: 11, color: 'theme:inkDim',
                             style: { fontFamily: 'theme:fontMono', letterSpacing: 1, lineHeight: 14, whiteSpace: 'pre' } },

  AppChatTurn: { type: 'Box', style: {
    flexDirection: 'column',
    gap: 6,
  }},

  AppChatTurnMetaRow: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, flexWrap: 'wrap',
  }},

  AppChatTurnAuthor: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    height: 16, paddingLeft: 4, paddingRight: 4,
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg2',
  }},

  AppChatTurnAuthorText: { type: 'Text', size: 9, bold: true, color: 'theme:inkDim',
                            style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },

  AppChatTurnTime: { type: 'Text', size: 9, color: 'theme:inkDimmer',
                     style: { fontFamily: 'theme:fontMono', letterSpacing: 1, lineHeight: 11, whiteSpace: 'pre' } },

  AppChatTurnTag: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    height: 16, paddingLeft: 4, paddingRight: 4,
    borderWidth: 1, borderColor: 'theme:accent',
    backgroundColor: 'theme:bg',
  }},

  AppChatTurnTagText: { type: 'Text', size: 9, bold: true, color: 'theme:accent',
                        style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },

  AppChatTurnLift: { type: 'Text', size: 9, color: 'theme:inkDimmer',
                     style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },

  AppChatTurnBody: { type: 'Text', size: 13, color: 'theme:ink',
                     style: { fontFamily: 'theme:fontSans', lineHeight: 18 } },

  AppChatYouTurn: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 8,
    paddingLeft: 10, paddingRight: 10,
    paddingTop: 6,   paddingBottom: 6,
    borderLeftWidth: 2,
    borderColor: 'theme:rule',
    backgroundColor: 'theme:bg1',
  }},

  AppChatYouTurnCaret: { type: 'Text', size: 13, color: 'theme:accent',
                         style: { fontFamily: 'theme:fontMono', lineHeight: 18, whiteSpace: 'pre' } },

  AppChatYouTurnText: { type: 'Text', size: 13, color: 'theme:ink',
                        style: { fontFamily: 'theme:fontSans', lineHeight: 18 } },

  // Embedded surface card (audit / fleet / etc.). Border is the
  // continuous-flow dash from Animation principles → Card / box borders
  // → Continuous marching flow ("this card is alive").
  AppChatSurfaceCard: { type: 'Box', style: {
    flexDirection: 'column',
    paddingLeft: 12, paddingRight: 12,
    paddingTop: 10,  paddingBottom: 10,
    gap: 10,
    backgroundColor: 'theme:bg1',
    borderWidth: 1, borderColor: 'theme:accentHot',
    borderDash: [44, 108],
    borderDashWidth: 1,
    borderFlowSpeed: 18,
  }},

  AppChatSurfaceHeader: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, flexWrap: 'wrap',
  }},

  AppChatSurfaceTitle: { type: 'Text', size: 14, bold: true, color: 'theme:ink',
                         style: { fontFamily: 'theme:fontSans', lineHeight: 18 } },

  AppChatSurfaceTag: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    height: 16, paddingLeft: 4, paddingRight: 4,
    borderWidth: 1, borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg',
  }},

  AppChatSurfaceTagText: { type: 'Text', size: 9, bold: true, color: 'theme:accentHot',
                            style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },

  AppChatSurfaceCommand: { type: 'Box', style: {
    paddingLeft: 10, paddingRight: 10,
    paddingTop: 6, paddingBottom: 6,
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg',
  }},

  AppChatSurfaceCommandText: { type: 'Text', size: 12, color: 'theme:accent',
                                style: { fontFamily: 'theme:fontMono', lineHeight: 16, whiteSpace: 'pre' } },

  AppChatSurfaceBody: { type: 'Text', size: 12, color: 'theme:inkDim',
                        style: { fontFamily: 'theme:fontSans', lineHeight: 16 } },

  AppChatSurfaceActions: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    gap: 8, flexWrap: 'wrap',
  }},

  AppChatSurfaceAction: { type: 'Pressable', style: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 24, paddingLeft: 10, paddingRight: 10,
    borderWidth: 1, borderColor: 'theme:rule',
    backgroundColor: 'theme:bg',
  }},

  AppChatSurfaceActionPrimary: { type: 'Pressable', style: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 24, paddingLeft: 10, paddingRight: 10,
    borderWidth: 1, borderColor: 'theme:accentHot',
    backgroundColor: 'theme:bg2',
  }},

  AppChatSurfaceActionText: { type: 'Text', size: 11, color: 'theme:ink',
                               style: { fontFamily: 'theme:fontMono', letterSpacing: 1, lineHeight: 13, whiteSpace: 'pre' } },

  // Fleet status pills — IDLE / TOOL / STUCK / RAT. One pill body per
  // state so the border / text colors stay token-driven and never drift
  // into hex. Add new states by adding a sibling classifier; never
  // inline a color here.
  AppChatStatusPill: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 18, paddingLeft: 6, paddingRight: 6,
    borderWidth: 1, borderColor: 'theme:ok',
    backgroundColor: 'theme:bg',
  }},

  AppChatStatusPillTool: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 18, paddingLeft: 6, paddingRight: 6,
    borderWidth: 1, borderColor: 'theme:accent',
    backgroundColor: 'theme:bg',
  }},

  AppChatStatusPillStuck: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 18, paddingLeft: 6, paddingRight: 6,
    borderWidth: 1, borderColor: 'theme:warn',
    backgroundColor: 'theme:bg',
  }},

  AppChatStatusPillRat: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 18, paddingLeft: 6, paddingRight: 6,
    borderWidth: 1, borderColor: 'theme:flag',
    backgroundColor: 'theme:bg',
  }},

  AppChatStatusPillText:      { type: 'Text', size: 9, bold: true, color: 'theme:ok',
                                style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },
  AppChatStatusPillTextTool:  { type: 'Text', size: 9, bold: true, color: 'theme:accent',
                                style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },
  AppChatStatusPillTextStuck: { type: 'Text', size: 9, bold: true, color: 'theme:warn',
                                style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },
  AppChatStatusPillTextRat:   { type: 'Text', size: 9, bold: true, color: 'theme:flag',
                                style: { fontFamily: 'theme:fontMono', letterSpacing: 2, lineHeight: 11, whiteSpace: 'pre' } },

  AppChatFleetGrid: { type: 'Box', style: {
    flexDirection: 'column',
    gap: 8,
  }},

  AppChatFleetRow: { type: 'Box', style: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, flexWrap: 'wrap',
  }},

  AppChatFleetCell: { type: 'Box', style: {
    flexDirection: 'column',
    gap: 4,
    minWidth: 84,
  }},

  AppChatFleetCellName: { type: 'Text', size: 12, color: 'theme:ink',
                          style: { fontFamily: 'theme:fontMono', lineHeight: 14, whiteSpace: 'pre' } },

  AppChatFleetNote: { type: 'Text', size: 12, color: 'theme:inkDim',
                      style: { fontFamily: 'theme:fontSans', lineHeight: 16 } },
});
