import { classifier, classifiers as C } from '../../runtime/classifier';

classifier({
  AppRoot: {
    type: 'Box',
    style: { width: '100%', height: '100%', backgroundColor: 'theme:bg' },
  },
  AppShell: {
    type: 'Box',
    style: {
      width: '100%',
      height: '100%',
      padding: 'theme:spacingLg',
      gap: 'theme:spacingMd',
      backgroundColor: 'theme:bg',
    },
  },
  AppHeader: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'theme:spacingMd',
      paddingBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: 'theme:border',
    },
  },
  AppTitleBlock: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 2, flexGrow: 1, flexBasis: 0 },
  },
  AppKicker: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTitle: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:text', fontWeight: 'bold' },
  AppSubtle: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textSecondary' },
  AppDim: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textDim' },
  AppNav: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingSm' },
  },
  AppNavItem: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 7,
      paddingBottom: 7,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover', borderColor: 'theme:borderFocus' },
  },
  AppNavText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:text' },
  AppBody: {
    type: 'Box',
    style: { flexGrow: 1, flexBasis: 0, gap: 'theme:spacingMd' },
  },
  AppRow: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 'theme:spacingMd' },
  },
  AppCol: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 'theme:spacingSm' },
  },
  AppPanel: {
    type: 'Box',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      padding: 'theme:spacingMd',
      gap: 'theme:spacingSm',
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    bp: {
      sm: { style: { flexBasis: 'auto' } },
    },
  },
  AppPanelTitle: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:text', fontWeight: 'bold' },
  AppMetric: { type: 'Text', fontSize: 28, color: 'theme:text', fontWeight: 'bold' },
  AppBadge: {
    type: 'Box',
    style: {
      alignSelf: 'flex-start',
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgElevated',
    },
  },
  AppBadgeText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTextInput: {
    type: 'TextInput',
    style: {
      height: 36,
      paddingLeft: 10,
      paddingRight: 10,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      color: 'theme:text',
    },
  },

  // ── Browse / Gallery ───────────────────────────────────────
  GalleryScrollView: {
    type: 'ScrollView',
    style: { flexGrow: 1, flexBasis: 0 },
  },
  GalleryGrid: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 'theme:spacingMd',
      paddingBottom: 'theme:spacingLg',
    },
  },
  GalleryCard: {
    type: 'Pressable',
    style: {
      width: 'calc(50% - 7px)',
      flexDirection: 'column',
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      overflow: 'hidden',
    },
    hoverStyle: { borderColor: 'theme:borderFocus', backgroundColor: 'theme:bgElevated' },
  },
  GalleryThumbnail: {
    type: 'Box',
    style: {
      width: '100%',
      height: 160,
      backgroundColor: 'theme:bgAlt',
    },
  },
  GalleryCardFooter: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 8,
      paddingBottom: 8,
    },
  },
  GalleryCardTitle: {
    type: 'Text',
    fontSize: 'theme:fontSm',
    color: 'theme:textSecondary',
    style: { flexShrink: 1 },
  },
  GalleryTypeBadge: {
    type: 'Box',
    style: {
      position: 'absolute',
      top: 8,
      left: 8,
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'rgba(0,0,0,0.75)',
    },
  },
  GalleryFavBadge: {
    type: 'Box',
    style: {
      position: 'absolute',
      top: 8,
      right: 8,
      paddingLeft: 6,
      paddingRight: 6,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'rgba(0,0,0,0.75)',
    },
  },
  GalleryRatingBadge: {
    type: 'Box',
    style: {
      position: 'absolute',
      bottom: 8,
      left: 8,
      paddingLeft: 6,
      paddingRight: 6,
      paddingTop: 3,
      paddingBottom: 3,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'rgba(0,0,0,0.75)',
    },
  },
  GalleryTypeText: {
    type: 'Text',
    fontSize: 'theme:fontSm',
    color: '#ffffff',
  },

  // ── Filters ────────────────────────────────────────────────
  FilterPill: {
    type: 'Pressable',
    style: {
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 5,
      paddingBottom: 5,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover', borderColor: 'theme:borderFocus' },
  },
  FilterPillText: {
    type: 'Text',
    fontSize: 'theme:fontSm',
    color: 'theme:textSecondary',
  },
  ActiveFilterChip: {
    type: 'Pressable',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:primary',
    },
  },
  ActiveFilterChipText: {
    type: 'Text',
    fontSize: 'theme:fontSm',
    color: '#0b1117',
  },

  // ── Detail View ────────────────────────────────────────────
  GalleryDetailHeader: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 'theme:spacingMd',
      borderBottomWidth: 'theme:borderThin',
      borderBottomColor: 'theme:border',
    },
  },
  GalleryDetailImage: {
    type: 'Box',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      backgroundColor: 'theme:bgAlt',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
  GalleryDetailFooter: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 'theme:spacingMd',
      borderTopWidth: 'theme:borderThin',
      borderTopColor: 'theme:border',
    },
  },
  GalleryPlayOverlay: {
    type: 'Box',
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
  },

  // ── Sections ───────────────────────────────────────────────
  Section: {
    type: 'Box',
    style: {
      gap: 'theme:spacingSm',
      paddingTop: 'theme:spacingMd',
      paddingBottom: 'theme:spacingMd',
      borderBottomWidth: 1,
      borderBottomColor: 'theme:border',
    },
  },
  SectionHeader: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
  },
  SectionTitle: {
    type: 'Text',
    fontSize: 'theme:fontMd',
    color: 'theme:text',
    fontWeight: 'bold',
  },
  SectionAction: {
    type: 'Text',
    fontSize: 'theme:fontSm',
    color: 'theme:primary',
  },

  // ── List Row ───────────────────────────────────────────────
  ListRow: {
    type: 'Pressable',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 'theme:spacingMd',
      padding: 'theme:spacingSm',
      borderBottomWidth: 1,
      borderBottomColor: 'theme:border',
    },
    hoverStyle: { backgroundColor: 'theme:bgElevated' },
  },
  ListRowThumb: {
    type: 'Box',
    style: {
      width: 48,
      height: 48,
      borderRadius: 'theme:radiusSm',
      overflow: 'hidden',
      backgroundColor: 'theme:bgAlt',
    },
  },
  ListRowMeta: {
    type: 'Box',
    style: { flexGrow: 1, flexBasis: 0, gap: 2 },
  },
  ListRowTitle: {
    type: 'Text',
    fontSize: 'theme:fontMd',
    color: 'theme:text',
  },
  ListRowSub: {
    type: 'Text',
    fontSize: 'theme:fontSm',
    color: 'theme:textDim',
  },

  // ── Settings / Stats ───────────────────────────────────────
  StatCard: {
    type: 'Box',
    style: {
      padding: 'theme:spacingMd',
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      alignItems: 'center',
      gap: 4,
    },
  },
  StatValue: {
    type: 'Text',
    fontSize: 24,
    color: 'theme:text',
    fontWeight: 'bold',
  },
  StatLabel: {
    type: 'Text',
    fontSize: 'theme:fontSm',
    color: 'theme:textDim',
  },

  // ── Video Overlay ──────────────────────────────────────────
  VideoOverlay: {
    type: 'Box',
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'space-between',
    },
  },
  VideoPlayButton: {
    type: 'Box',
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
  VideoControlBar: {
    type: 'Box',
    style: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingLeft: 14,
      paddingRight: 14,
      paddingTop: 10,
      paddingBottom: 10,
      backgroundColor: 'rgba(0,0,0,0.7)',
    },
  },
  VideoProgressTrack: {
    type: 'Box',
    style: {
      height: 4,
      borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.25)',
      marginTop: 8,
    },
  },
  VideoProgressFill: {
    type: 'Box',
    style: {
      height: 4,
      borderRadius: 2,
      backgroundColor: 'theme:primary',
    },
  },
  VideoTimeText: {
    type: 'Text',
    fontSize: 12,
    color: '#ffffff',
  },

  // ── Forms ──────────────────────────────────────────────────
  InlineEditRow: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 'theme:spacingSm',
    },
  },
  EmptyState: {
    type: 'Box',
    style: {
      padding: 'theme:spacingLg',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 'theme:spacingSm',
    },
  },
  EmptyStateText: {
    type: 'Text',
    fontSize: 'theme:fontMd',
    color: 'theme:textDim',
  },
});

export { C };
