// cart/editor/shell/regions.ts — the FIXED-REGION LAYOUT CONTRACT (req_2627).
//
// The editor window breaks into primitively-named FIXED regions. Each region's
// dimensions are CONSTANTS — they never shift with app state; only the content
// inside a region swaps. Everything rendered inside a region therefore knows
// its available space as a constant imported from HERE, never deduced from app
// state. This module codifies the editor's CURRENT real geometry (it does not
// redesign it) so workspace.cls.ts and panel content share one source of truth.
//
// Region map (the user's vocabulary), top to bottom / left to right:
//
//   ┌────────────────────── window chrome (37) ──────────────────────┐
//   │ rail │ content browser │        viewport (flexes)  │ focus     │
//   │ (48) │      (350)      │  [action bar 36 on top]   │ panel     │
//   │      │                 │                           │ (326)     │
//   └────────────────────── status bar (31) ─────────────────────────┘
//
// Content rules that hang off this contract: no whole-panel scrolling (nested
// scrolls inside bounded sub-areas instead), paged assets over long scroll,
// and content must justify its use of the fixed space.

/** All region borders are the theme's thin border (theme:borderThin = 1px). */
const BORDER = 1;

/** The standard horizontal gutter panel bodies put between their border and content. */
const PANEL_GUTTER = 10;

// ── Region outer dimensions (the fixed numbers) ────────────────────────────
const CHROME_HEIGHT = 37; // window chrome: brand + menu bar + Compile + route toggle (HW_Chrome)
const ACTION_BAR_HEIGHT = 36; // action bar: THE toolbar row above the stage (HW_ToolOptions)
const LEFT_RAIL_WIDTH = 48; // domain rail on the far left edge (HW_LeftRail)
const CONTENT_BROWSER_WIDTH = 350; // content browser, left panel (HW_SidePanel)
const FOCUS_PANEL_WIDTH = 326; // focus panel, right panel (HW_RightPanel)
const FOCUS_RAIL_WIDTH = 40; // the pane-switch icon rail INSIDE the focus panel (HW_RightRail)
const STATUS_BAR_HEIGHT = 31; // status bar: the bottom build dock (HW_BuildDock)

export const REGIONS = {
  /** WINDOW CHROME — the top strip. Menu bar, Compile, Editor/Play toggle. */
  chrome: { height: CHROME_HEIGHT },

  /** ACTION BAR — the tool row (ToolOptions) pinned under the chrome, above the stage. */
  actionBar: { height: ACTION_BAR_HEIGHT },

  /** LEFT RAIL — the domain icon strip on the window's left edge. */
  leftRail: { width: LEFT_RAIL_WIDTH },

  /**
   * CONTENT BROWSER — the left panel (tree, search, asset grids, model gallery).
   * innerWidth is what content actually gets: outer minus the right border and
   * the standard 10px gutters. Import THIS, don't re-derive it from state.
   */
  contentBrowser: {
    width: CONTENT_BROWSER_WIDTH,
    gutter: PANEL_GUTTER,
    innerWidth: CONTENT_BROWSER_WIDTH - BORDER - PANEL_GUTTER * 2, // 329
  },

  /** VIEWPORT — the center stage. The ONE region that flexes; no fixed number. */
  viewport: { flexes: true },

  /**
   * FOCUS PANEL — the right panel (inspector / piece focus / model focus).
   * bodyWidth = outer minus its left border and the pane-switch rail;
   * innerWidth = bodyWidth minus the inspector body's 10px gutters — the
   * constant every focus-panel card/section lays out against.
   */
  focusPanel: {
    width: FOCUS_PANEL_WIDTH,
    railWidth: FOCUS_RAIL_WIDTH,
    bodyWidth: FOCUS_PANEL_WIDTH - BORDER - FOCUS_RAIL_WIDTH, // 285
    gutter: PANEL_GUTTER,
    innerWidth: FOCUS_PANEL_WIDTH - BORDER - FOCUS_RAIL_WIDTH - PANEL_GUTTER * 2, // 265
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
