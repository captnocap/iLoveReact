import type { GallerySection } from '../types';

import { chartSection } from './chart.story';
import { galleryDisplayContainerSection } from './gallery-display-container.story';
import { flowEditorSection } from './flow-editor.story';
import { areaChartSection } from './area-chart.story';
import { barChartSection } from './bar-chart.story';
import { boxplotSection } from './boxplot.story';
import { brailleGraphSection } from './braille-graph.story';
import { bubbleCorrelationSection } from './bubble-correlation.story';
import { bubbleScatterplotSection } from './bubble-scatterplot.story';
import { candlestickSection } from './candlestick.story';
import { circularBarChartSection } from './circular-bar-chart.story';
import { circularProgressSection } from './circular-progress.story';
import { combinationChartSection } from './combination-chart.story';
import { contourMapSection } from './contour-map.story';
import { divergingChartSection } from './diverging-chart.story';
import { donutBarChartSection } from './donut-bar-chart.story';
import { fanChartSection } from './fan-chart.story';
import { flowMapSection } from './flow-map.story';
import { fractionChartSection } from './fraction-chart.story';
import { groupedBarChartSection } from './grouped-bar-chart.story';
import { heatmapSection } from './heatmap.story';
import { layeredPyramidSection } from './layered-pyramid.story';
import { networkSchemeSection } from './network-scheme.story';
import { pictorialFractionChartSection } from './pictorial-fraction-chart.story';
import { polarChartSection } from './polar-chart.story';
import { populationPyramidSection } from './population-pyramid.story';
import { processCircleSection } from './process-circle.story';
import { progressSection } from './progress.story';
import { proportionFiltersSection } from './proportion-filters.story';
import { pyramidChartSection } from './pyramid-chart.story';
import { radarSection } from './radar.story';
import { ringsInPieChartSection } from './rings-in-pie-chart.story';
import { scatterplotSection } from './scatterplot.story';
import { splineGraphSection } from './spline-graph.story';
import { surplusSection } from './surplus.story';
import { timelineSection } from './timeline.story';
import { trackingSection } from './tracking.story';
import { vennSection } from './venn.story';
import { waterfallChartSection } from './waterfall-chart.story';
import { chartDemoDataSection } from './chart-demo-data.story';
import { calendarDimensionSection } from './calendar-dimension.story';
import { genericCardSection } from './generic-card.story';
import { genericChatCardSection } from './generic-chat-card.story';
import { consoleHeaderSection } from './console-header.story';
import { transcriptFlowSection } from './transcript-flow.story';
import { telemetryStatsSection } from './telemetry-stats.story';
import { taskPanelSection } from './task-panel.story';
import { modelCardSection } from './model-card.story';
import { skeletonTilesSection } from './skeleton-tiles.story';
import { sweatshopMatrixDisplaySection } from './sweatshop-matrix-display.story';
import { astQuiltSection } from './ast-quilt.story';
import { astTileBoxSection } from './ast-tile-box.story';
import { easingsSection } from './easings.story';
import { easingsLatchSection } from './easings-latch.story';
import { easingsLatchFullSection } from './easings-latch-full.story';
import { easingsLatchOnlySection } from './easings-latch-only.story';
import { easingsZigMathSection } from './easings-zig-math.story';
import { easingsZigStaticSection } from './easings-zig-static.story';
import { easingsHostIntervalSection } from './easings-host-interval.story';
import { easingsShaderSection } from './easings-shader.story';
import { animatedTextSection } from './animated-text.story';
import { animatedTextShaderSection } from './animated-text-shader.story';
import { gridSpinnersSection } from './grid-spinners.story';
import { timeInstrumentsSection } from './time-instruments.story';
import { conditionalGuttersSection } from './conditional-gutters.story';
import { hairlineSliderSection } from './hairline-slider.story';
import { filledRailSliderSection } from './filled-rail-slider.story';
import { discreteSliderSection } from './discrete-slider.story';
import { bipolarSliderSection } from './bipolar-slider.story';
import { rangeSliderSection } from './range-slider.story';
import { stepSliderSection } from './step-slider.story';
import { meterSliderSection } from './meter-slider.story';
import { verticalThinFaderSection } from './vertical-thin-fader.story';
import { verticalNotchFaderSection } from './vertical-notch-fader.story';
import { verticalStripFaderSection } from './vertical-strip-fader.story';
import { verticalBipolarFaderSection } from './vertical-bipolar-fader.story';
import { choiceListSection } from './choice-list.story';
import { segmentedControlSection } from './segmented-control.story';
import { diodeSelectorSection } from './diode-selector.story';
import { stackSelectorSection } from './stack-selector.story';
import { keycapSelectorSection } from './keycap-selector.story';
import { pipeSelectorSection } from './pipe-selector.story';
import { statusBadgeSection } from './status-badge.story';
import { keyValueBadgeSection } from './key-value-badge.story';
import { bracketBadgeSection } from './bracket-badge.story';
import { tierBadgeSection } from './tier-badge.story';
import { countBadgeSection } from './count-badge.story';
import { stripBadgeSection } from './strip-badge.story';
import { cautionBadgeSection } from './caution-badge.story';
import { metricBadgeSection } from './metric-badge.story';
import { verticalBadgeSection } from './vertical-badge.story';
import { glyphStackBadgeSection } from './glyph-stack-badge.story';
import { sideTabCardSection } from './side-tab-card.story';
import { unitRailSection } from './unit-rail.story';
import { totemStackSection } from './totem-stack.story';
import { verticalCautionBadgeSection } from './vertical-caution-badge.story';
import { prefixDataCardSection } from './prefix-data-card.story';
import { specColumnSection } from './spec-column.story';
import { ladderTrailSection } from './ladder-trail.story';
import { sideSpineCrumbsSection } from './side-spine-crumbs.story';
import { tabularHierarchySection } from './tabular-hierarchy.story';
import { chronologyTrailSection } from './chronology-trail.story';
import { marginaliaPanelSection } from './marginalia-panel.story';
import { axisReadoutSection } from './axis-readout.story';
import { fileTabCardSection } from './file-tab-card.story';
import { scaleLabelCardSection } from './scale-label-card.story';
import { layerControlAtomSections } from './layer-control-atoms.story';
import { latexSection } from './latex.story';
import { cockpitSection } from './cockpit.story';
import { workerEventSection } from './worker-event.story';
import { workerSessionSection } from './worker-session.story';
import { claudeCliRawEventSection } from './claude-cli-raw-event.story';
import { eventAdapterSection } from './event-adapter.story';
import { providerSection } from './provider.story';
import { modelSection } from './model.story';
import { connectionSection } from './connection.story';
import { codexRawEventSection } from './codex-raw-event.story';
import { envVarSection } from './env-var.story';
import { assistantSection } from './assistant.story';
import { userSection } from './user.story';
import { agentMemorySection } from './agent-memory.story';
import { inferenceParameterSection } from './inference-parameter.story';
import { inferencePresetSection } from './inference-preset.story';
import { settingsSection } from './settings.story';
import { privacySection } from './privacy.story';
import { inferenceRequestSection } from './inference-request.story';
import { budgetSection } from './budget.story';
import { capabilitySection } from './capability.story';
import { systemMessageSection } from './system-message.story';
import { promptTemplateSection } from './prompt-template.story';
import { skillSection } from './skill.story';
import { roleSection } from './role.story';
import { roleAssignmentSection } from './role-assignment.story';
import { workspaceSection } from './workspace.story';
import { projectSection } from './project.story';
import { environmentSection } from './environment.story';
import { supervisorSection } from './supervisor.story';
import { workerSection } from './worker.story';
import { workingMemorySection } from './working-memory.story';
import { episodicMemorySection } from './episodic-memory.story';
import { semanticMemorySection } from './semantic-memory.story';
import { proceduralMemorySection } from './procedural-memory.story';
import { classifierCatalogSection } from './classifier-catalog.story';
import { iconCatalogSection } from './icon-catalog.story';
import { planSection } from './plan.story';
import { planningPhaseSection } from './planning-phase.story';
import { taskGraphSection } from './task-graph.story';
import { taskSection } from './task.story';
import { taskDependencySection } from './task-dependency.story';
import { researchSection } from './research.story';
import { dexFrameSection } from './dex-frame.story';
import { dexSearchBarSection } from './dex-search-bar.story';
import { dexBreadcrumbsSection } from './dex-breadcrumbs.story';
import { dexTypeBadgeSection } from './dex-type-badge.story';
import { dexTreeRowSection } from './dex-tree-row.story';
import { dexSparkHistogramSection } from './dex-spark-histogram.story';
import { dexTableCellSection } from './dex-table-cell.story';
import { dexSpatialNodeSection } from './dex-spatial-node.story';
import { dexHeatCellSection } from './dex-heat-cell.story';
import { genericCardShellSection } from './generic-card-shell.story';
import { genericCardHeaderSection } from './generic-card-header.story';
import { genericCardTitleBlockSection } from './generic-card-title-block.story';
import { genericCardSketchPanelSection } from './generic-card-sketch-panel.story';
import { genericCardMetricBarSection } from './generic-card-metric-bar.story';
import { genericCardDataRowSection } from './generic-card-data-row.story';
import { dexTreeExplorerSection } from './dex-tree-explorer.story';
import { dexTableExplorerSection } from './dex-table-explorer.story';
import { dexSpatialExplorerSection } from './dex-spatial-explorer.story';
import { dexGraphExplorerSection } from './dex-graph-explorer.story';
import { dexGraphEdgeSection } from './dex-graph-edge.story';
import { dexGraphNodeSection } from './dex-graph-node.story';
import { dexSpatialRingSection } from './dex-spatial-ring.story';
import { dexCanvasRingSection } from './dex-canvas-ring.story';
import { dexCanvasEdgeSection } from './dex-canvas-edge.story';
import { dexCanvasNodeSection } from './dex-canvas-node.story';
import { taskClaimSection } from './task-claim.story';
import { budgetLedgerSection } from './budget-ledger.story';
import { workstreamSection } from './workstream.story';
import { barrierSection } from './barrier.story';
import { mergeProposalSection } from './merge-proposal.story';
import { mergeConflictSection } from './merge-conflict.story';
import { embeddingSection } from './embedding.story';
import { embeddingModelSection } from './embedding-model.story';
import { retrievalStrategySection } from './retrieval-strategy.story';
import { retrievalQuerySection } from './retrieval-query.story';
import { jobSection } from './job.story';
import { jobRunSection } from './job-run.story';
import { goalSection } from './goal.story';
import { constraintSection } from './constraint.story';
import { eventSection } from './event.story';
import { ruleSection } from './rule.story';
import { outcomeRubricSection } from './outcome-rubric.story';
import { userInterventionSection } from './user-intervention.story';
import { interpretationSection } from './interpretation.story';
import { projectGlossarySection } from './project-glossary.story';
import { modelRouteSection } from './model-route.story';
import { documentViewerSection } from './document-viewer.story';
import { documentPageSection } from './document-page.story';
import { documentToolbarSection } from './document-toolbar.story';
import { documentOutlineSection } from './document-outline.story';
import { documentBlockSection } from './document-block.story';
import { basicWorkerCardSection } from './basic-worker-card.story';
import { tooltipFrameSection } from './tooltip-frame.story';
import { tooltipHeaderSection } from './tooltip-header.story';
import { tooltipDataRowSection } from './tooltip-data-row.story';
import { tooltipSection } from './tooltip.story';
import { notificationSection } from './notification.story';
import { tweenArchSection } from './tween-arch.story';
import { toolbarSection } from './toolbar.story';
import { goalCardSection } from './goal-card.story';
import { taskCardSection } from './task-card.story';
import { workerCardSection } from './worker-card.story';
import { constraintBadgeSection } from './constraint-badge.story';
import { presetCardSection } from './preset-card.story';
import { rubricPanelSection } from './rubric-panel.story';
import { hookListSection } from './hook-list.story';
import { promptCompositionSection } from './prompt-composition.story';
import { compositionSourceKindSection } from './composition-source-kind.story';
import { promptFragmentSection } from './prompt-fragment.story';
import { codeSnippetSection } from './code-snippet.story';
import { codeBlockSection } from './code-block.story';
import { codeLineSection } from './code-line.story';
import { codeLineNumberSection } from './code-line-number.story';
import { syntaxHighlighterSection } from './syntax-highlighter.story';
import { codeCopyButtonSection } from './code-copy-button.story';
import { intentSurfaceSection } from './intent-surface.story';
import { spreadsheetAtomSections } from './spreadsheet-atoms.story';
import { spreadsheetSection } from './spreadsheet.story';
import { commandComposerSection } from './command-composer.story';
import { commandComposerAtomSections } from './command-composer-atoms.story';
import { gitActivitySection } from './git-activity.story';
import { gitLaneFrameSection } from './git-lane-frame.story';
import { gitLaneGraphSection } from './git-lane-graph.story';
import { gitCommitRailRowSection } from './git-commit-rail-row.story';
import { gitDiffPreviewSection } from './git-diff-preview.story';
import { gitLanesSection } from './git-lanes.story';
import { commandComposerPanelSection } from './command-composer-panel.story';
import { layerControlPanelSection } from './layer-control-panel.story';
import { menuGallerySections } from './menu-gallery.story';
import { blockFacesSection } from './block-faces.story';
import { newsFeedPostSection } from './news-feed-post.story';
import { newsFeedSection } from './news-feed.story';
import { socialImageGallerySection } from './social-image-gallery.story';
import { characterSection } from './character.story';
import { personalityDialSection } from './personality-dial.story';
import { characterArchetypeSection } from './character-archetype.story';
import { characterQuirkSection } from './character-quirk.story';
import { userManifestSection } from './user-manifest.story';
import { manifestDimensionSection } from './manifest-dimension.story';
import { quizSessionSection } from './quiz-session.story';
import { characterCompatibilitySection } from './character-compatibility.story';
import { avatarSection } from './avatar.story';
// component-gallery:imports

export const storySections: GallerySection[] = [
  classifierCatalogSection,
  iconCatalogSection,
  galleryDisplayContainerSection,
  chartSection,
  areaChartSection,
  barChartSection,
  boxplotSection,
  brailleGraphSection,
  bubbleCorrelationSection,
  bubbleScatterplotSection,
  candlestickSection,
  circularBarChartSection,
  circularProgressSection,
  combinationChartSection,
  contourMapSection,
  divergingChartSection,
  donutBarChartSection,
  fanChartSection,
  flowMapSection,
  fractionChartSection,
  groupedBarChartSection,
  heatmapSection,
  layeredPyramidSection,
  networkSchemeSection,
  pictorialFractionChartSection,
  polarChartSection,
  populationPyramidSection,
  processCircleSection,
  progressSection,
  proportionFiltersSection,
  pyramidChartSection,
  radarSection,
  ringsInPieChartSection,
  scatterplotSection,
  splineGraphSection,
  surplusSection,
  timelineSection,
  trackingSection,
  vennSection,
  waterfallChartSection,
  chartDemoDataSection,
  calendarDimensionSection,
  genericCardSection,
  genericChatCardSection,
  consoleHeaderSection,
  transcriptFlowSection,
  telemetryStatsSection,
  taskPanelSection,
  modelCardSection,
  skeletonTilesSection,
  sweatshopMatrixDisplaySection,
  astQuiltSection,
  astTileBoxSection,
  easingsSection,
  easingsLatchSection,
  easingsLatchOnlySection,
  easingsLatchFullSection,
  easingsZigMathSection,
  easingsZigStaticSection,
  easingsHostIntervalSection,
  easingsShaderSection,
  animatedTextSection,
  animatedTextShaderSection,
  gridSpinnersSection,
  timeInstrumentsSection,
  conditionalGuttersSection,
  hairlineSliderSection,
  filledRailSliderSection,
  discreteSliderSection,
  bipolarSliderSection,
  rangeSliderSection,
  stepSliderSection,
  meterSliderSection,
  verticalThinFaderSection,
  verticalNotchFaderSection,
  verticalStripFaderSection,
  verticalBipolarFaderSection,
  choiceListSection,
  segmentedControlSection,
  diodeSelectorSection,
  stackSelectorSection,
  keycapSelectorSection,
  pipeSelectorSection,
  statusBadgeSection,
  keyValueBadgeSection,
  bracketBadgeSection,
  tierBadgeSection,
  countBadgeSection,
  stripBadgeSection,
  cautionBadgeSection,
  metricBadgeSection,
  verticalBadgeSection,
  glyphStackBadgeSection,
  sideTabCardSection,
  unitRailSection,
  totemStackSection,
  verticalCautionBadgeSection,
  prefixDataCardSection,
  specColumnSection,
  ladderTrailSection,
  sideSpineCrumbsSection,
  tabularHierarchySection,
  chronologyTrailSection,
  marginaliaPanelSection,
  axisReadoutSection,
  fileTabCardSection,
  scaleLabelCardSection,
  ...layerControlAtomSections,
  latexSection,
  cockpitSection,
  workerEventSection,
  workerSessionSection,
  claudeCliRawEventSection,
  eventAdapterSection,
  providerSection,
  modelSection,
  connectionSection,
  codexRawEventSection,
  envVarSection,
  assistantSection,
  userSection,
  agentMemorySection,
  inferenceParameterSection,
  inferencePresetSection,
  settingsSection,
  privacySection,
  inferenceRequestSection,
  budgetSection,
  capabilitySection,
  systemMessageSection,
  promptTemplateSection,
  skillSection,
  roleSection,
  roleAssignmentSection,
  workspaceSection,
  projectSection,
  environmentSection,
  supervisorSection,
  workerSection,
  workingMemorySection,
  episodicMemorySection,
  semanticMemorySection,
  proceduralMemorySection,
  planSection,
  planningPhaseSection,
  taskGraphSection,
  taskSection,
  taskDependencySection,
  researchSection,
  dexFrameSection,
  dexSearchBarSection,
  dexBreadcrumbsSection,
  dexTypeBadgeSection,
  dexTreeRowSection,
  dexSparkHistogramSection,
  dexTableCellSection,
  dexSpatialNodeSection,
  dexHeatCellSection,
  genericCardShellSection,
  genericCardHeaderSection,
  genericCardTitleBlockSection,
  genericCardSketchPanelSection,
  genericCardMetricBarSection,
  genericCardDataRowSection,
  dexTreeExplorerSection,
  dexTableExplorerSection,
  dexSpatialExplorerSection,
  dexGraphExplorerSection,
  dexGraphEdgeSection,
  dexGraphNodeSection,
  dexSpatialRingSection,
  dexCanvasRingSection,
  dexCanvasEdgeSection,
  dexCanvasNodeSection,
  taskClaimSection,
  budgetLedgerSection,
  workstreamSection,
  barrierSection,
  mergeProposalSection,
  mergeConflictSection,
  embeddingSection,
  embeddingModelSection,
  retrievalStrategySection,
  retrievalQuerySection,
  jobSection,
  jobRunSection,
  goalSection,
  constraintSection,
  eventSection,
  ruleSection,
  outcomeRubricSection,
  userInterventionSection,
  interpretationSection,
  projectGlossarySection,
  modelRouteSection,
  documentViewerSection,
  documentPageSection,
  documentToolbarSection,
  documentOutlineSection,
  documentBlockSection,
  basicWorkerCardSection,
  tooltipFrameSection,
  tooltipHeaderSection,
  tooltipDataRowSection,
  tooltipSection,
  notificationSection,
  tweenArchSection,
  toolbarSection,
  goalCardSection,
  taskCardSection,
  workerCardSection,
  constraintBadgeSection,
  presetCardSection,
  rubricPanelSection,
  hookListSection,
  promptCompositionSection,
  compositionSourceKindSection,
  promptFragmentSection,
  codeSnippetSection,
  codeBlockSection,
  codeLineSection,
  codeLineNumberSection,
  syntaxHighlighterSection,
  codeCopyButtonSection,
  intentSurfaceSection,
  flowEditorSection,
  spreadsheetSection,
  ...spreadsheetAtomSections,
  commandComposerSection,
  ...commandComposerAtomSections,
  gitActivitySection,
  gitLaneFrameSection,
  gitLaneGraphSection,
  gitCommitRailRowSection,
  gitDiffPreviewSection,
  gitLanesSection,
  commandComposerPanelSection,
  layerControlPanelSection,
  ...menuGallerySections,
  blockFacesSection,
  socialImageGallerySection,
  newsFeedPostSection,
  newsFeedSection,
  characterSection,
  personalityDialSection,
  characterArchetypeSection,
  characterQuirkSection,
  userManifestSection,
  manifestDimensionSection,
  quizSessionSection,
  characterCompatibilitySection,
  avatarSection,
  // component-gallery:sections
];
