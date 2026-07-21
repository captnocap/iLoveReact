// cart/editor/shell/regions.ts — the FIXED-REGION LAYOUT CONTRACT (req_2627).
//
// The editor window breaks into primitively-named regions. Every OPEN region's
// dimensions are CONSTANTS; the center viewport is the sole flexing region.
// Sections C and G may remove their panel BODY while their adjacent fixed rail
// remains, giving that width back to the viewport (req_3266). Content still lays
// out against constants imported from HERE, never window measurements.
//
// Region map (the user's vocabulary), top to bottom / left to right:
//
//   ┌──────────────────── A window chrome (37) ──────────────────────┐
//   │  B   │        C        │  D  [action bar 36]       │           │
//   │ rail │ content browser │  E     viewport (flexes)  │ body│rail │
//   │ (48) │   (0/350/680)   │                           │0/285│40  │
//   │      │                 │  F  [stage tabs]          │           │
//   └──────────────────── H status bar (31) ─────────────────────────┘
//
// Content rules that hang off this contract: no whole-panel scrolling (nested
// scrolls inside bounded sub-areas instead), paged assets over long scroll,
// and content must justify its use of the fixed space.
//
// ── SECTIONS (req_2970) — the prompting vocabulary ──────────────────────────
// Every persistent block of the editor UI carries a section LETTER so an ask
// can say "add that to section C" instead of describing geometry. A section is
// a block in the UI flow (its pixel shape is irrelevant); there are exactly
// eight, lettered in reading order — top strip, then left → right through the
// body, then bottom. Floating layers (dialogs, popovers, context menus,
// in-viewport docks) are NOT sections — they belong to the section that spawns
// them. Each owning component is stamped `SECTION <X>` at its top; grep for
// that to land in the right file.
export const SECTIONS = {
  A: { region: 'chrome', name: 'Window Chrome', file: 'shell/Chrome.tsx', contains: 'Shitty Games brand · menu bar · active map · Editor/Play toggle · window controls' },
  B: { region: 'leftRail', name: 'Left Rail', file: 'shell/LeftRail.tsx', contains: 'contextual input buttons: Paint and relevant source libraries coexist while painting; active-button repeat collapses/reopens C' },
  C: { region: 'contentBrowser', name: 'Left Panel', file: 'library/LibraryPanel.tsx + shell/PaintSidePanel.tsx', contains: 'one replaceable slot: asset browser (0/350/680) or unified Paint tools + layers + brush + ink (0/350)' },
  D: { region: 'actionBar', name: 'Action Bar', file: 'stage/ToolOptions.tsx', contains: 'THE compact mesh/world toolbar; paint sub-tools, safety, and resolution live persistently in C' },
  E: { region: 'viewport', name: 'Stage', file: 'stage/Stage.tsx', contains: 'the flexing center surface (world / model / playtest / animation / material focus) + its in-viewport docks (BuildBar, MapPaintDock)' },
  F: { region: 'viewport', name: 'Stage Tabs', file: 'stage/StageTabs.tsx', contains: 'the open-document tab strip at the bottom edge of the stage' },
  G: { region: 'focusPanel', name: 'Focus Panel', file: 'inspector/Inspector.tsx', contains: 'contextual focus body + persistent 40px rail; model view exposes Model / Paint / Rig, active-button repeat collapses/reopens the body' },
  H: { region: 'statusBar', name: 'Status Bar', file: 'shell/BuildDock.tsx', contains: 'build dock: undo/redo · build journal · eventbus · perf · memory · status line · coords' },
} as const;

export type SectionLetter = keyof typeof SECTIONS;

/** All region borders are the theme's thin border (theme:borderThin = 1px). */
const BORDER = 1;

/** The standard horizontal gutter panel bodies put between their border and content. */
const PANEL_GUTTER = 10;

// ── Region outer dimensions (the fixed numbers) ────────────────────────────
const CHROME_HEIGHT = 37; // window chrome: brand + menu bar + active map + route toggle (HW_Chrome)
const ACTION_BAR_HEIGHT = 36; // action bar: THE toolbar row above the stage (HW_ToolOptions)
const LEFT_RAIL_WIDTH = 48; // domain rail on the far left edge (HW_LeftRail)
const CONTENT_BROWSER_WIDTH = 350; // content browser, left panel (HW_SidePanel)
// When present, the content browser has TWO fixed states (req_3135): the tucked
// micro dock (350) and expanded tree + thumbnail grid (680). Its collapsed state
// omits the body entirely; the separate 48px rail remains.
const CONTENT_BROWSER_WIDTH_EXPANDED = 680; // content browser, expanded (HW_SidePanelWide)
const CONTENT_BROWSER_TREE_WIDTH = 218; // expanded mode: the fixed tree column (HW_LibTreeCol)
const FOCUS_PANEL_WIDTH = 326; // open focus body + rail (HW_RightPanel)
const FOCUS_PANEL_ATLAS_WIDTH = 480; // Blockbench-scale UV workspace + rail
const FOCUS_PANEL_ATLAS_EXPANDED_WIDTH = 760; // dense-mesh UV workspace; stage remains visible beside it
const FOCUS_RAIL_WIDTH = 40; // the pane-switch icon rail INSIDE the focus panel (HW_RightRail)
const STATUS_BAR_HEIGHT = 31; // status bar: the bottom build dock (HW_BuildDock)

export const REGIONS = {
  /** WINDOW CHROME — the top strip. Menu bar, active map, Editor/Play toggle. */
  chrome: { height: CHROME_HEIGHT },

  /** ACTION BAR — the tool row (ToolOptions) pinned under the chrome, above the stage. */
  actionBar: { height: ACTION_BAR_HEIGHT },

  /** LEFT RAIL — contextual input-pane buttons on the window's left edge. */
  leftRail: { width: LEFT_RAIL_WIDTH },

  /**
   * CONTENT BROWSER — the left panel (tree, search, asset grids, model gallery).
   * innerWidth is what content actually gets: outer minus the right border and
   * the standard 10px gutters. Import THIS, don't re-derive it from state.
   */
  contentBrowser: {
    width: CONTENT_BROWSER_WIDTH,
    expandedWidth: CONTENT_BROWSER_WIDTH_EXPANDED,
    treeWidth: CONTENT_BROWSER_TREE_WIDTH,
    gutter: PANEL_GUTTER,
    innerWidth: CONTENT_BROWSER_WIDTH - BORDER - PANEL_GUTTER * 2, // 329
    // Expanded grid column's usable width: expanded outer minus the panel's right
    // border, the tree column + its divider, and the standard gutters.
    gridInnerWidth: CONTENT_BROWSER_WIDTH_EXPANDED - BORDER - CONTENT_BROWSER_TREE_WIDTH - BORDER - PANEL_GUTTER * 2, // 440
  },

  /** VIEWPORT — the center stage. The ONE region that flexes; no fixed number. */
  viewport: { flexes: true },

  /**
   * FOCUS PANEL — the open right body plus its persistent contextual rail.
   * bodyWidth = outer minus its left border and the pane-switch rail;
   * innerWidth = bodyWidth minus the inspector body's 10px gutters — the
   * constant every focus-panel card/section lays out against.
   */
  focusPanel: {
    width: FOCUS_PANEL_WIDTH,
    atlasWidth: FOCUS_PANEL_ATLAS_WIDTH,
    atlasExpandedWidth: FOCUS_PANEL_ATLAS_EXPANDED_WIDTH,
    railWidth: FOCUS_RAIL_WIDTH,
    bodyWidth: FOCUS_PANEL_WIDTH - BORDER - FOCUS_RAIL_WIDTH, // 285
    atlasBodyWidth: FOCUS_PANEL_ATLAS_WIDTH - BORDER - FOCUS_RAIL_WIDTH,
    atlasExpandedBodyWidth: FOCUS_PANEL_ATLAS_EXPANDED_WIDTH - BORDER - FOCUS_RAIL_WIDTH,
    gutter: PANEL_GUTTER,
    innerWidth: FOCUS_PANEL_WIDTH - BORDER - FOCUS_RAIL_WIDTH - PANEL_GUTTER * 2, // 265
    atlasInnerWidth: FOCUS_PANEL_ATLAS_WIDTH - BORDER - FOCUS_RAIL_WIDTH - PANEL_GUTTER * 2,
    atlasExpandedInnerWidth: FOCUS_PANEL_ATLAS_EXPANDED_WIDTH - BORDER - FOCUS_RAIL_WIDTH - PANEL_GUTTER * 2,
  },

  /** STATUS BAR — the bottom strip (the build dock: undo/redo, coords, perf). */
  statusBar: { height: STATUS_BAR_HEIGHT },

  /**
   * THE SHARED CONTROL GRID (req_2626 II) — panel rows sit on fixed columns:
   * a fixed label column, values/controls flexing to ONE right edge, fixed
   * stepper/value/reset columns, one baseline per row. Rows RESERVE space
   * ("we are not bartering for UI space"); labels never wrap.
   */
  grid: {
    /** fixed label column for form/read rows (HW_FormLabel). */
    labelWidth: 82,
    /** square − / + stepper button (HW_OvBtn). */
    stepBtn: 20,
    /** numeric value cell between steppers (HW_OvVal). */
    valueWidth: 40,
    /** trailing reset-rider column — ALWAYS reserved, set or not (HW_OvReset/Idle). */
    endBtn: 18,
    /** minimum read-row height, one baseline (HW_ReadRow). */
    rowHeight: 21,
    /** a section's action row: fixed height, verbs on the row (HW_VerbRow). */
    verbRowHeight: 24,
    /** button height inside a verb row (HW_VerbPrimary/HW_VerbFixed). */
    verbHeight: 22,
    /** fixed-width secondary verb column at the right edge (HW_VerbFixed). */
    verbColWidth: 56,
  },
} as const;
