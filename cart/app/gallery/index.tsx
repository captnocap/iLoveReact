import { useEffect, useMemo, useState } from 'react';
import './components.cls';
import { TooltipRoot } from '@reactjit/runtime/tooltip/Tooltip';
import {
  useFuzzySearch,
  type FuzzyMode,
  type FuzzySearchCandidate,
  type FuzzySearchOptions,
  type FuzzySearchResult,
} from '@reactjit/runtime/hooks/useFuzzySearch';
import { Box, Col, Pressable, Row, ScrollView, StaticSurface, Text, TextInput } from '@reactjit/runtime/primitives';
import { Icon } from '@reactjit/runtime/icons/Icon';
import { ChevronDown, ChevronRight } from '@reactjit/runtime/icons/icons';
import { Route, Router, useNavigate, useRoute } from './local-router';
import { GalleryDisplayContainer } from './components/gallery-display-container/GalleryDisplayContainer';
import { AuditPage } from './audit-page';
import { ChartAnimationProvider } from './lib/useSpring';
import { findGalleryThemeOption, useGalleryTheme } from './gallery-theme';
import { gallerySections } from './registry';
import { COLORS, PAGE_SURFACE } from './surface';
import {
  formatCanonicalTagLabel,
  getCanonicalStoryTags,
  getCanonicalTagOrder,
  getRawStoryTags,
  resolveGalleryGroup,
} from './taxonomy';
import { countThemeTokens, mergeThemeTokenCategories } from './theme-system';
import {
  getDataStoryReferences,
  getDataStoryStorage,
  getStoryVariants,
  getThemeStoryClassifiers,
  getThemeStoryVariants,
  isDataStory,
  isThemeStory,
} from './types';
import type { GalleryCanonicalTag } from './taxonomy';
import type {
  GalleryDataStorage,
  GalleryDataStory,
  GalleryDataReferenceKind,
  GalleryGroup,
  GallerySection,
  GallerySectionKind,
  GalleryStory,
  GalleryThemeClassifierKind,
  GalleryThemeStory,
  GalleryThemeTokenValue,
  GalleryThemeVariant,
  GalleryVariant,
} from './types';

type StoryEntry = {
  section: GallerySection;
  story: GalleryStory;
};

type StoryNavCategoryId = 'tokens' | 'data' | 'components' | 'atoms';

type StoryNavCategory = {
  id: StoryNavCategoryId;
  title: string;
  order: number;
  entries: StoryEntry[];
};

type FilterOption = {
  id: string;
  label: string;
  order?: number;
};

type SearchCandidate = FuzzySearchCandidate;

const NAV_SEARCH_MODE: FuzzyMode = 'strict';

type NavigationFilters = {
  kind: 'all' | GallerySectionKind;
  groupId: 'all' | string;
  tag: 'all' | string;
};

type Selection = {
  storyId: string;
  variantId: string;
};

type NextGalleryRouteId = 'data' | 'atoms' | 'components' | 'tokens';

const NEXT_GALLERY_ROUTES: Array<{ id: NextGalleryRouteId; label: string; path: string }> = [
  { id: 'data', label: 'Data', path: '/data' },
  { id: 'atoms', label: 'Atoms', path: '/atoms' },
  { id: 'components', label: 'Components', path: '/components' },
  { id: 'tokens', label: 'Tokens', path: '/tokens' },
];

const NEXT_GALLERY_ROUTE_PREFIX: Record<NextGalleryRouteId, string> = {
  data: 'D',
  atoms: 'A',
  components: 'C',
  tokens: 'T',
};

const NEXT_GALLERY_GRID_CARD = {
  width: 250,
  height: 250,
  topbarHeight: 22,
  stagePadding: 12,
  gap: 14,
  pagePadding: 18,
};

const NEXT_GALLERY_FILTER_COLUMNS = 16;
const NEXT_GALLERY_FILTER_TAB_WIDTH = '6.25%';
const NEXT_GALLERY_FILTER_ROW_HEIGHT = 34;

// ─── PERF DEBUG KNOB ───────────────────────────────────────────────────
// Binary-search dial for the atoms-page slowness. Each level adds one
// piece of work back on top of the previous level. Flip this and reload.
// `ChartAnimationProvider disabled` always wraps variant renders — it's
// not part of the perf experiment, it's a sanity guard against
// run-amok preview animations.
//
//   0 — empty placeholder Box. No variant.render() at all. Baseline.
//   1 — variant.render() inside a flex-centered un-scaled box. Tests if
//       rendering the variant tree itself is the cost.
//   2 — full layout-and-scale pipeline (transform: scale + canvas-sized
//       intermediate box). Final form.
const PERF_BUDGET: 0 | 1 | 2 = 2;

// ─── ATOM BISECT KNOB ──────────────────────────────────────────────────
// Tiles whose index falls in [start, end) render their variants normally
// (subject to PERF_BUDGET above). Tiles outside the range render the
// level-0 placeholder Box only. Use to bisect which atoms are causing the
// per-frame work blowup.
//
//   [0, 999]  — render all variants (default)
//   [0, 15]   — first half on, second half off
//   [15, 999] — opposite
//   [10, 12]  — narrow to two specific atoms
//   [0, 0]    — render NOTHING (equivalent to PERF_BUDGET=0)
const VARIANT_RANGE: [number, number] = [0, 9999];

// Virtualization for the 'all' grid: how many extra rows of tiles to keep
// mounted above and below the visible viewport. Higher = smoother scroll
// (less mount/unmount churn), lower = fewer concurrent renders.
const VIRTUAL_BUFFER_ROWS = 2;

const NEXT_GALLERY_PREVIEW_CANVAS: Record<NextGalleryRouteId, { width: number; height: number }> = {
  data: { width: 520, height: 360 },
  atoms: { width: 420, height: 360 },
  components: { width: 720, height: 420 },
  tokens: { width: 720, height: 420 },
};

const KIND_TITLES: Record<GallerySectionKind, string> = {
  'top-level': 'Top-Level',
  atom: 'Atoms',
};

const NAV_CATEGORY_META: Record<StoryNavCategoryId, { title: string; order: number }> = {
  tokens: { title: 'Tokens', order: 10 },
  data: { title: 'Data Shapes', order: 20 },
  atoms: { title: 'Atoms', order: 30 },
  components: { title: 'Components', order: 40 },
};

const STORAGE_TITLES: Record<GalleryDataStorage, string> = {
  localstore: 'Localstore',
  'sqlite-document': 'SQLite Document',
  'sqlite-table': 'SQLite Table',
  'json-file': 'JSON File',
  'atomic-file-to-db': 'Atomic File -> DB',
};

const DATA_REFERENCE_TITLES: Record<GalleryDataReferenceKind, string> = {
  references: 'References',
  'belongs-to': 'Belongs To',
  'has-many': 'Has Many',
  dimension: 'Dimension',
};

const THEME_CLASSIFIER_TITLES: Record<GalleryThemeClassifierKind, string> = {
  theme: 'Theme Classifier',
  style: 'Style Classifier',
  variant: 'Variant Classifier',
  breakpoint: 'Breakpoint Classifier',
};

const COMPOSITION_PREVIEW_LIMIT = 6;
const COMPOSITION_SCROLL_HEIGHT = 220;
const GALLERY_ROUTER_HOT_KEY = '.:route';
const ROUTE_DEFAULT_VARIANT = 'overview';
const CHIP_RADIUS = 6;
const USE_EMPTY_GALLERY_SHELL = true;

function getThemeStringToken(
  tokens: Record<string, GalleryThemeTokenValue> | undefined,
  path: string,
  fallback: string
): string {
  const value = tokens?.[path];
  return typeof value === 'string' ? value : fallback;
}

function flattenStories(sections: GallerySection[]): StoryEntry[] {
  const entries: StoryEntry[] = [];
  for (const section of sections) {
    for (const story of section.stories) {
      entries.push({ section, story });
    }
  }
  return entries;
}

function countVariants(stories: StoryEntry[]): number {
  let total = 0;
  for (const entry of stories) total += getStoryVariants(entry.story).length;
  return total;
}

function getDefaultVariantId(entry: StoryEntry): string {
  return getStoryVariants(entry.story)[0]?.id || ROUTE_DEFAULT_VARIANT;
}

function storyRoutePath(entry: StoryEntry, variantId?: string): string {
  return `/stories/${encodeURIComponent(entry.story.id)}/${encodeURIComponent(variantId || getDefaultVariantId(entry))}`;
}

function routeSelection(storyId: string | undefined, variantId: string | undefined): Selection | null {
  if (!storyId) return null;
  return {
    storyId,
    variantId: variantId || ROUTE_DEFAULT_VARIANT,
  };
}

function getTextInputValue(value: any): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.value === 'string') return value.value;
    if (typeof value.target?.value === 'string') return value.target.value;
    return '';
  }
  return String(value);
}

function initialGalleryRoutePath(): string {
  return '/data';
}

function countStoriesByKind(stories: StoryEntry[], kind: GallerySectionKind): number {
  let total = 0;
  for (const entry of stories) {
    if (getSectionKind(entry.section) === kind) total += 1;
  }
  return total;
}

function sortStoryEntries(stories: StoryEntry[]): StoryEntry[] {
  const baseTitles = new Set(
    stories
      .map((entry) => entry.story.title.toLowerCase())
      .filter((title) => !title.includes(' '))
  );
  const sortKey = (entry: StoryEntry): string => {
    const title = entry.story.title.toLowerCase();
    const words = title.split(/\s+/);
    const last = words[words.length - 1] || title;
    if (words.length > 1 && baseTitles.has(last)) {
      return `${last} ${words.slice(0, -1).join(' ')}`;
    }
    return title;
  };
  return [...stories].sort((a, b) => {
    const byKey = sortKey(a).localeCompare(sortKey(b));
    return byKey !== 0 ? byKey : a.story.title.localeCompare(b.story.title);
  });
}

function getSourceName(source: string): string {
  const parts = source.split('/');
  return parts[parts.length - 1] || source;
}

function getSourceLabel(source: string): string {
  const base = getSourceName(source).replace(/\.[^.]+$/, '');
  return base.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function getSectionGroup(section: GallerySection): GalleryGroup {
  return resolveGalleryGroup(section);
}

function getSectionKind(section: GallerySection): GallerySectionKind {
  return section.kind || 'atom';
}

function getComposedOf(section: GallerySection): string[] {
  return (section.composedOf || []).map((part) => part.trim()).filter(Boolean);
}

function getThemeCount(story: GalleryStory): number {
  return getThemeStoryVariants(story).length;
}

function formatStorageLabel(storage: GalleryDataStorage): string {
  return STORAGE_TITLES[storage] || storage;
}

function formatDataReferenceLabel(kind: GalleryDataReferenceKind): string {
  return DATA_REFERENCE_TITLES[kind] || kind;
}

function formatThemeClassifierLabel(kind: GalleryThemeClassifierKind): string {
  return THEME_CLASSIFIER_TITLES[kind] || kind;
}

function getStoryTags(section: GallerySection, story: GalleryStory): GalleryCanonicalTag[] {
  return getCanonicalStoryTags(section, story);
}

function getStoryTypeLabel(entry: StoryEntry): string {
  if (isThemeStory(entry.story)) return 'Theme System';
  if (isDataStory(entry.story)) return 'Data Shape';
  return KIND_TITLES[getSectionKind(entry.section)];
}

function getNextGalleryCategory(entry: StoryEntry): NextGalleryRouteId {
  if (isDataStory(entry.story)) return 'data';
  if (isThemeStory(entry.story)) return 'tokens';
  if (getSectionKind(entry.section) === 'top-level') return 'components';
  return 'atoms';
}

function getNextGalleryEntries(stories: StoryEntry[], categoryId: NextGalleryRouteId): StoryEntry[] {
  return stories.filter((entry) => getNextGalleryCategory(entry) === categoryId);
}

function getNextGalleryRouteMeta(categoryId: NextGalleryRouteId) {
  return NEXT_GALLERY_ROUTES.find((route) => route.id === categoryId) || NEXT_GALLERY_ROUTES[0];
}

function formatNextGalleryCode(categoryId: NextGalleryRouteId, index: number): string {
  return `${NEXT_GALLERY_ROUTE_PREFIX[categoryId]}${index + 1}`;
}

function formatNextGalleryTabLabel(title: string): string {
  return title
    .replace(/\bMenu\s+A\d+\b/gi, 'Menu')
    .replace(/\bA\d+\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGridPreviewScale(canvas: { width: number; height: number }): number {
  const availableWidth = NEXT_GALLERY_GRID_CARD.width - NEXT_GALLERY_GRID_CARD.stagePadding * 2;
  const availableHeight =
    NEXT_GALLERY_GRID_CARD.height - NEXT_GALLERY_GRID_CARD.topbarHeight - NEXT_GALLERY_GRID_CARD.stagePadding * 2;
  return Math.min(1, availableWidth / canvas.width, availableHeight / canvas.height);
}

// Resolve the preview canvas for a story+variant. Variant override wins,
// then story override, then per-category default.
function resolvePreviewCanvas(
  categoryId: NextGalleryRouteId,
  story: GalleryStory,
  variant: GalleryVariant | null,
): { width: number; height: number } {
  return (
    variant?.previewCanvas
    ?? story.previewCanvas
    ?? NEXT_GALLERY_PREVIEW_CANVAS[categoryId]
  );
}

function getTagTone(tag: GalleryCanonicalTag): string {
  if (tag === 'theme') return COLORS.accent;
  if (tag === 'data') return COLORS.success;
  if (tag === 'motion') return COLORS.warning;
  return COLORS.muted;
}

function pushSearchCandidate(
  candidates: SearchCandidate[],
  seen: Set<string>,
  text: string,
  weight: number,
  mode: FuzzyMode
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const key = `${mode}:${trimmed.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ text: trimmed, weight, mode });
}

function getDataStorySearchKeys(story: GalleryStory): string[] {
  if (!isDataStory(story)) return [];

  const schemaKeys =
    story.schema && typeof story.schema === 'object' && !Array.isArray(story.schema)
      ? Object.keys(story.schema)
      : [];
  const propertyKeys =
    story.schema &&
    typeof story.schema === 'object' &&
    !Array.isArray(story.schema) &&
    story.schema.properties &&
    typeof story.schema.properties === 'object' &&
    !Array.isArray(story.schema.properties)
      ? Object.keys(story.schema.properties as Record<string, unknown>)
      : [];
  const mockKeys =
    story.mockData && typeof story.mockData === 'object' && !Array.isArray(story.mockData)
      ? Object.keys(story.mockData as Record<string, unknown>)
      : [];
  const referenceKeys = getDataStoryReferences(story).flatMap((reference) => [
    reference.label,
    formatDataReferenceLabel(reference.kind),
    reference.targetSource,
    getSourceName(reference.targetSource),
    getSourceLabel(reference.targetSource),
    reference.sourceField || '',
    reference.targetField || '',
    reference.summary || '',
  ]);

  return [...new Set([...schemaKeys, ...propertyKeys, ...mockKeys, ...referenceKeys].map((key) => key.trim()).filter(Boolean))];
}

function getThemeStorySearchKeys(story: GalleryStory): string[] {
  if (!isThemeStory(story)) return [];

  const keys: string[] = [];
  for (const classifier of getThemeStoryClassifiers(story)) {
    if (classifier.label) keys.push(classifier.label);
    keys.push(formatThemeClassifierLabel(classifier.kind));
    keys.push(getSourceName(classifier.source));
    keys.push(getSourceLabel(classifier.source));
  }

  for (const category of story.globalTokens) {
    keys.push(category.title);
    keys.push(...Object.keys(category.tokens || {}));
  }

  for (const theme of story.themes) {
    keys.push(theme.id, theme.title);
    if (theme.summary) keys.push(theme.summary);
    for (const category of theme.tokens) {
      keys.push(category.title);
      keys.push(...Object.keys(category.tokens || {}));
    }
  }

  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
}

function getSearchCandidates(entry: StoryEntry): SearchCandidate[] {
  const story = entry.story;
  const group = getSectionGroup(entry.section);
  const candidates: SearchCandidate[] = [];
  const seen = new Set<string>();

  pushSearchCandidate(candidates, seen, story.title, 1, NAV_SEARCH_MODE);
  pushSearchCandidate(candidates, seen, getSourceLabel(story.source), 0.95, NAV_SEARCH_MODE);
  pushSearchCandidate(candidates, seen, getSourceName(story.source), 0.9, NAV_SEARCH_MODE);
  pushSearchCandidate(candidates, seen, entry.section.title, 0.8, NAV_SEARCH_MODE);
  pushSearchCandidate(candidates, seen, group.title, 0.7, NAV_SEARCH_MODE);
  pushSearchCandidate(candidates, seen, getSectionKind(entry.section) === 'top-level' ? 'Top-Level' : 'Atom', 0.5, NAV_SEARCH_MODE);

  for (const tag of getStoryTags(entry.section, story)) {
    pushSearchCandidate(candidates, seen, tag, 0.75, NAV_SEARCH_MODE);
    pushSearchCandidate(candidates, seen, formatCanonicalTagLabel(tag), 0.7, NAV_SEARCH_MODE);
  }

  for (const rawTag of getRawStoryTags(story)) {
    pushSearchCandidate(candidates, seen, rawTag, 0.45, NAV_SEARCH_MODE);
  }

  for (const storage of getDataStoryStorage(story)) {
    pushSearchCandidate(candidates, seen, formatStorageLabel(storage), 0.65, NAV_SEARCH_MODE);
  }

  for (const variant of getStoryVariants(story)) {
    pushSearchCandidate(candidates, seen, variant.name, 0.65, NAV_SEARCH_MODE);
  }

  for (const atomPath of getComposedOf(entry.section)) {
    pushSearchCandidate(candidates, seen, getSourceLabel(atomPath), 0.6, NAV_SEARCH_MODE);
    pushSearchCandidate(candidates, seen, getSourceName(atomPath), 0.55, NAV_SEARCH_MODE);
  }

  for (const key of getDataStorySearchKeys(story)) {
    pushSearchCandidate(candidates, seen, key, 0.6, NAV_SEARCH_MODE);
  }

  for (const key of getThemeStorySearchKeys(story)) {
    pushSearchCandidate(candidates, seen, key, 0.7, NAV_SEARCH_MODE);
  }

  return candidates;
}

function collectGroupFilters(stories: StoryEntry[]): FilterOption[] {
  const groups = new Map<string, FilterOption>();
  for (const entry of stories) {
    const group = getSectionGroup(entry.section);
    if (!groups.has(group.id)) {
      groups.set(group.id, {
        id: group.id,
        label: group.title,
        order: group.order ?? 999,
      });
    }
  }

  return [...groups.values()].sort((left, right) => {
    const byOrder = (left.order ?? 999) - (right.order ?? 999);
    return byOrder !== 0 ? byOrder : left.label.localeCompare(right.label);
  });
}

function collectTagFilters(stories: StoryEntry[]): FilterOption[] {
  const tags = new Map<string, FilterOption>();
  for (const entry of stories) {
    for (const tag of getStoryTags(entry.section, entry.story)) {
      if (!tags.has(tag)) {
        tags.set(tag, {
          id: tag,
          label: formatCanonicalTagLabel(tag),
          order: getCanonicalTagOrder(tag),
        });
      }
    }
  }

  return [...tags.values()].sort((left, right) => {
    const byOrder = (left.order ?? 1000) - (right.order ?? 1000);
    return byOrder !== 0 ? byOrder : left.label.localeCompare(right.label);
  });
}

function filterStoryEntriesByFilters(stories: StoryEntry[], filters: NavigationFilters): StoryEntry[] {
  return stories.filter((entry) => {
    if (filters.kind !== 'all' && getSectionKind(entry.section) !== filters.kind) return false;
    if (filters.groupId !== 'all' && getSectionGroup(entry.section).id !== filters.groupId) return false;
    if (
      filters.tag !== 'all' &&
      !getStoryTags(entry.section, entry.story).some((tag) => tag === filters.tag)
    ) {
      return false;
    }
    return true;
  });
}

function pickSelection(
  stories: StoryEntry[],
  selection: Selection | null
): { entry: StoryEntry | null; variant: GalleryVariant | null } {
  if (stories.length === 0) return { entry: null, variant: null };

  const entry =
    (selection && stories.find((candidate) => candidate.story.id === selection.storyId)) || stories[0];
  const variants = getStoryVariants(entry.story);
  const variant =
    (selection && variants.find((candidate) => candidate.id === selection.variantId)) ||
    variants[0] ||
    null;

  return { entry, variant };
}

function pickRoutedSelection(
  stories: StoryEntry[],
  selection: Selection | null
): { entry: StoryEntry | null; variant: GalleryVariant | null } {
  if (!selection || stories.length === 0) return { entry: null, variant: null };

  const entry = stories.find((candidate) => candidate.story.id === selection.storyId) || null;
  if (!entry) return { entry: null, variant: null };

  const variants = getStoryVariants(entry.story);
  const variant =
    variants.find((candidate) => candidate.id === selection.variantId) ||
    variants[0] ||
    null;

  return { entry, variant };
}

function getNavigationCategory(entry: StoryEntry): StoryNavCategoryId {
  const group = getSectionGroup(entry.section);
  if (isDataStory(entry.story)) return 'data';
  if (isThemeStory(entry.story) || group.id === 'themes') return 'tokens';
  if (getSectionKind(entry.section) === 'top-level') return 'components';
  return 'atoms';
}

function groupVisibleStories(stories: StoryEntry[], preserveRank = false): StoryNavCategory[] {
  const categories = new Map<StoryNavCategoryId, StoryEntry[]>();
  for (const entry of stories) {
    const category = getNavigationCategory(entry);
    const entries = categories.get(category) || [];
    entries.push(entry);
    categories.set(category, entries);
  }

  const orderedCategories = [...categories.entries()];
  if (!preserveRank) {
    orderedCategories.sort((left, right) => NAV_CATEGORY_META[left[0]].order - NAV_CATEGORY_META[right[0]].order);
  }

  return orderedCategories.map(([id, entries]) => ({
    id,
    title: NAV_CATEGORY_META[id].title,
    order: NAV_CATEGORY_META[id].order,
    entries: preserveRank ? entries : sortStoryEntries(entries),
  }));
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Col
      style={{
        width: 112,
        height: 48,
        justifyContent: 'center',
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 8,
        backgroundColor: COLORS.panelBg,
        borderWidth: 1,
        borderColor: COLORS.border,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: 'bold', color: tone }}>{value}</Text>
      <Text style={{ fontSize: 10, color: COLORS.muted }}>{label}</Text>
    </Col>
  );
}

function GalleryThemeToggle({
  label,
  activeLabel,
  disabled,
  swatchBackground,
  swatchBorder,
  swatchColor,
  onCycle,
}: {
  label: string;
  activeLabel: string;
  disabled?: boolean;
  swatchBackground: string;
  swatchBorder: string;
  swatchColor: string;
  onCycle: () => void;
}) {
  return (
    <Row
      style={{
        width: 224,
        height: 48,
        alignItems: 'center',
        gap: 8,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 8,
        backgroundColor: COLORS.panelBg,
        borderWidth: 1,
        borderColor: COLORS.border,
      }}
    >
      <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 9, color: COLORS.muted }}>{label}</Text>
        <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLORS.text }}>{activeLabel}</Text>
      </Col>
      <Box
        style={{
          width: 24,
          height: 30,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 7,
          backgroundColor: swatchBackground,
          borderWidth: 1,
          borderColor: swatchBorder,
        }}
      >
        <Box style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: swatchColor }} />
      </Box>
      <NavActionButton label="Theme" disabled={disabled} onPress={onCycle} />
    </Row>
  );
}

function NavActionButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        if (!disabled) onPress();
      }}
      style={{
        height: 30,
        flexGrow: 1,
        flexBasis: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 7,
        backgroundColor: disabled ? COLORS.railBg : COLORS.panelBg,
        borderWidth: 1,
        borderColor: disabled ? COLORS.border : COLORS.borderStrong,
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: 'bold', color: disabled ? COLORS.faint : COLORS.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 24,
        paddingLeft: 8,
        paddingRight: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: CHIP_RADIUS,
        backgroundColor: active ? COLORS.accent : COLORS.panelBg,
        borderWidth: 1,
        borderColor: active ? COLORS.accent : COLORS.border,
      }}
    >
      <Text style={{ fontSize: 9, fontWeight: 'bold', color: active ? COLORS.accentInk : COLORS.muted }}>
        {label}
      </Text>
    </Pressable>
  );
}

function MetaBadge({
  label,
  tone,
  background,
}: {
  label: string;
  tone: string;
  background: string;
}) {
  return (
    <Box
      style={{
        height: 22,
        paddingLeft: 8,
        paddingRight: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: CHIP_RADIUS,
        backgroundColor: background,
        borderWidth: 1,
        borderColor: tone,
      }}
    >
      <Text style={{ fontSize: 9, fontWeight: 'bold', color: tone }}>{label}</Text>
    </Box>
  );
}

function FilterSection({
  label,
  children,
}: {
  label: string;
  children: any;
}) {
  return (
    <Col style={{ width: '100%', gap: 4 }}>
      <Text style={{ fontSize: 9, fontWeight: 'bold', color: COLORS.faint }}>{label}</Text>
      <Row style={{ width: '100%', gap: 6, flexWrap: 'wrap' }}>{children}</Row>
    </Col>
  );
}

function StoryNavGroupHeader({
  title,
  count,
  collapsed,
  onPress,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: '100%',
        minHeight: 36,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 7,
        paddingBottom: 7,
        borderRadius: 8,
        backgroundColor: COLORS.panelBg,
        borderWidth: 1,
        borderColor: COLORS.border,
      }}
    >
      <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Col style={{ gap: 1, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLORS.text }}>{title}</Text>
          <Text style={{ fontSize: 9, color: COLORS.muted }}>
            {`${count} ${count === 1 ? 'entry' : 'entries'}`}
          </Text>
        </Col>
        <Icon icon={collapsed ? ChevronRight : ChevronDown} size={13} color={COLORS.faint} strokeWidth={2.2} />
      </Row>
    </Pressable>
  );
}

function StoryNavItem({
  entry,
  active,
  index,
  onPress,
}: {
  entry: StoryEntry;
  active: boolean;
  index: number;
  onPress: () => void;
}) {
  const kind = getSectionKind(entry.section);
  const dataStory = isDataStory(entry.story);
  const themeStory = isThemeStory(entry.story);
  const kindLabel = themeStory ? 'THEME' : dataStory ? 'DATA' : kind === 'top-level' ? 'TOP' : 'ATOM';
  const kindTone = themeStory
    ? COLORS.accent
    : dataStory
      ? COLORS.success
      : kind === 'top-level'
        ? COLORS.compose
        : COLORS.faint;
  const tagSummary = getStoryTags(entry.section, entry.story)
    .slice(0, 2)
    .map(formatCanonicalTagLabel)
    .join(' · ');
  const status = entry.story.status || 'draft';
  const variantCount = getStoryVariants(entry.story).length;
  const themeCount = getThemeCount(entry.story);
  const detailLabel = themeStory
    ? themeCount > 1
      ? `${themeCount}t`
      : 'TOK'
    : dataStory
      ? 'JSON'
      : variantCount > 1
        ? `${variantCount}v`
        : status.slice(0, 1).toUpperCase();

  return (
    <StaticSurface>
    <Pressable
      onPress={onPress}
      style={{
        width: '100%',
        minHeight: tagSummary ? 42 : 32,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 4,
        paddingBottom: 4,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        backgroundColor: active ? COLORS.panelRaised : COLORS.railBg,
        borderWidth: 1,
        borderColor: active ? COLORS.accent : COLORS.border,
      }}
    >
      <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          <Text
            style={{
              fontSize: 13,
              fontWeight: active ? 'bold' : 'normal',
              color: active ? COLORS.text : COLORS.muted,
            }}
          >
            {entry.story.title}
          </Text>
          {tagSummary ? (
            <Text style={{ fontSize: 8, color: active ? COLORS.accent : COLORS.faint }}>{tagSummary}</Text>
          ) : null}
        </Col>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Text
            style={{ width: 22, fontSize: 10, fontWeight: 'bold', color: active ? COLORS.accent : COLORS.faint }}
          >
            {String(index + 1)}
          </Text>
          <Text style={{ width: 30, fontSize: 9, fontWeight: 'bold', color: active ? COLORS.text : kindTone }}>
            {kindLabel}
          </Text>
          <Text
            style={{
              width: 34,
              fontSize: 10,
              fontWeight: dataStory || themeStory ? 'bold' : 'normal',
              color: themeStory
                ? COLORS.accent
                : dataStory
                  ? COLORS.success
                  : variantCount > 1
                    ? COLORS.success
                    : COLORS.faint,
            }}
          >
            {detailLabel}
          </Text>
        </Row>
      </Row>
    </Pressable>
    </StaticSurface>
  );
}

function VariantButton({
  variant,
  active,
  onPress,
}: {
  variant: GalleryVariant;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 96,
        height: 34,
        paddingLeft: 12,
        paddingRight: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        backgroundColor: active ? COLORS.accent : COLORS.panelBg,
        borderWidth: 1,
        borderColor: active ? COLORS.accent : COLORS.border,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: 'bold',
          color: active ? COLORS.accentInk : COLORS.text,
        }}
      >
        {variant.name}
      </Text>
    </Pressable>
  );
}

function EmptyPreview() {
  return (
    <Col
      style={{
        flexGrow: 1,
        flexBasis: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>
        No gallery stories registered
      </Text>
      <Text style={{ fontSize: 12, color: PAGE_SURFACE.mutedTextColor }}>cart/app/gallery</Text>
    </Col>
  );
}

function StoryStage({ children }: { children: any }) {
  return (
    <Col
      style={{
        width: '100%',
        minWidth: 0,
        minHeight: PAGE_SURFACE.minHeight - PAGE_SURFACE.padding * 2,
        alignItems: 'center',
        justifyContent: 'center',
        // Some stories (FlowChart, etc.) hardcode a width wider than
        // the gallery viewport; without this clip their overflow
        // forces a page-level horizontal scrollbar that fights the
        // column-stack layout of the rest of the page.
        overflow: 'hidden',
      }}
    >
      {children}
    </Col>
  );
}

function CompositionPanel({
  entry,
  atomStoriesBySource,
  onSelectAtom,
}: {
  entry: StoryEntry;
  atomStoriesBySource: Map<string, StoryEntry>;
  onSelectAtom: (entry: StoryEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const kind = getSectionKind(entry.section);
  if (kind !== 'top-level') return null;

  const atoms = getComposedOf(entry.section);
  if (atoms.length === 0) return null;

  const canCollapse = atoms.length > COMPOSITION_PREVIEW_LIMIT;
  const visibleAtoms = expanded || !canCollapse ? atoms : atoms.slice(0, COMPOSITION_PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, atoms.length - visibleAtoms.length);

  const renderAtomRow = (atomPath: string) => {
    const atomEntry = atomStoriesBySource.get(atomPath) || null;

    if (!atomEntry) {
      return (
        <Box
          key={atomPath}
          style={{
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 4,
            paddingBottom: 4,
            borderRadius: CHIP_RADIUS,
            backgroundColor: COLORS.panelBg,
            borderWidth: 1,
            borderColor: COLORS.border,
          }}
        >
          <Text style={{ fontSize: 9, color: COLORS.muted }}>
            {`${getSourceLabel(atomPath)} · missing`}
          </Text>
        </Box>
      );
    }

    return (
      <Pressable
        key={atomPath}
        onPress={() => onSelectAtom(atomEntry)}
        style={{
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 4,
          paddingBottom: 4,
          borderRadius: CHIP_RADIUS,
          backgroundColor: COLORS.panelBg,
          borderWidth: 1,
          borderColor: COLORS.accent,
        }}
      >
        <Text style={{ fontSize: 9, fontWeight: 'bold', color: COLORS.text }}>
          {atomEntry.story.title}
        </Text>
      </Pressable>
    );
  };

  return (
    <Col
      style={{
        width: '100%',
        marginTop: 10,
        padding: 10,
        gap: 5,
        borderRadius: 8,
        backgroundColor: COLORS.railBg,
        borderWidth: 1,
        borderColor: COLORS.border,
      }}
    >
      <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 2 }}>
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: COLORS.text }}>
            {`Composed of ${atoms.length} atoms`}
          </Text>
          <Text style={{ fontSize: 8, color: COLORS.muted }}>
            {expanded
              ? 'Scroll the references or jump straight to an atom page.'
              : canCollapse
                ? `Showing ${visibleAtoms.length} of ${atoms.length}`
                : 'Linked atom pages'}
          </Text>
        </Col>
        {canCollapse && (
          <Pressable
            onPress={() => setExpanded((current) => !current)}
            style={{
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 5,
              paddingBottom: 5,
              borderRadius: CHIP_RADIUS,
              backgroundColor: COLORS.panelBg,
              borderWidth: 1,
              borderColor: COLORS.border,
            }}
          >
            <Text style={{ fontSize: 8, fontWeight: 'bold', color: COLORS.text }}>
              {expanded ? 'Show less' : `Show all ${atoms.length}`}
            </Text>
          </Pressable>
        )}
      </Row>

      {expanded ? (
        <ScrollView
          style={{
            width: '100%',
            maxHeight: COMPOSITION_SCROLL_HEIGHT,
          }}
          showScrollbar
        >
          <Row style={{ width: '100%', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }}>
            {visibleAtoms.map(renderAtomRow)}
          </Row>
        </ScrollView>
      ) : (
        <Row style={{ width: '100%', flexWrap: 'wrap', gap: 6, alignItems: 'flex-start' }}>
          {visibleAtoms.map(renderAtomRow)}
        </Row>
      )}

      {!expanded && hiddenCount > 0 && (
        <Pressable
          onPress={() => setExpanded(true)}
          style={{
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: 7,
            paddingBottom: 7,
            borderRadius: 6,
            backgroundColor: COLORS.panelBg,
            borderWidth: 1,
            borderColor: COLORS.border,
          }}
        >
          <Text style={{ fontSize: 9, fontWeight: 'bold', color: COLORS.accent }}>
            {`${hiddenCount} more atoms`}
          </Text>
        </Pressable>
      )}
    </Col>
  );
}

function describeJsonValue(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (value && typeof value === 'object') {
    const count = Object.keys(value as Record<string, unknown>).length;
    return `${count} ${count === 1 ? 'field' : 'fields'}`;
  }
  if (value === null) return 'null';
  return typeof value;
}

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || (value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]');
}

function formatJsonPrimitive(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  return String(value);
}

function describeJsonPreviewLeaf(value: unknown): string {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return 'url';
    if (/^#/.test(value)) return 'ref';
    if (value.length > 18) return 'string';
    return value;
  }
  if (value === null) return 'null';
  return typeof value;
}

function getJsonSchemaPreviewFields(value: unknown): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const objectValue = value as Record<string, unknown>;
  const properties = objectValue.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    return Object.entries(properties as Record<string, unknown>);
  }
  return Object.entries(objectValue);
}

function formatJsonContainerOpen(value: Record<string, unknown> | unknown[]): string {
  return Array.isArray(value) ? '[' : '{';
}

function formatJsonContainerClose(value: Record<string, unknown> | unknown[]): string {
  return Array.isArray(value) ? ']' : '}';
}

function getJsonChildren(value: Record<string, unknown> | unknown[]): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    return value.map((entry, index) => [String(index), entry]);
  }
  try {
    return Object.entries(value);
  } catch {
    return [];
  }
}

function shouldCollapseJsonNodeByDefault(depth: number): boolean {
  return depth >= 1;
}

function hasJsonNodeState(collapsed: Record<string, boolean>, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(collapsed, path);
}

function getJsonNodeCollapsedState(
  collapsed: Record<string, boolean>,
  path: string,
  depth: number
): boolean {
  return hasJsonNodeState(collapsed, path) ? collapsed[path] : shouldCollapseJsonNodeByDefault(depth);
}

const JSON_TREE_MAX_DEPTH = 64;
const JSON_PREVIEW_MAX_DEPTH = 3;
const JSON_PREVIEW_MAX_ROWS = 12;

type JsonPreviewRow = {
  key: string;
  depth: number;
  label?: string;
  value: string;
  container: boolean;
  required?: boolean;
  kind?: JsonSchemaPreviewKind;
};

type JsonSchemaPreviewKind =
  | 'array'
  | 'object'
  | 'map'
  | 'enum'
  | 'ref'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'choice'
  | 'unknown';

function JsonTreeNode({
  name,
  value,
  path,
  depth,
  collapsed,
  onToggle,
}: {
  name?: string;
  value: unknown;
  path: string;
  depth: number;
  collapsed: Record<string, boolean>;
  onToggle: (path: string, depth: number) => void;
}) {
  if (depth > JSON_TREE_MAX_DEPTH) {
    return (
      <Row style={{ width: '100%', minHeight: 20, alignItems: 'flex-start', paddingLeft: depth * 14, gap: 6 }}>
        {name ? <Text style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.textColor }}>{`${name}:`}</Text> : null}
        <Text style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.mutedTextColor }}>{'[max depth exceeded]'}</Text>
      </Row>
    );
  }

  const indent = depth * 14;
  const container = isJsonContainer(value);

  if (!container) {
    return (
      <Row
        style={{
          width: '100%',
          minHeight: 20,
          alignItems: 'flex-start',
          paddingLeft: indent,
          gap: 6,
        }}
      >
        {name ? (
          <Text style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.textColor }}>
            {`${name}:`}
          </Text>
        ) : null}
        <Text style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.textColor }}>
          {formatJsonPrimitive(value)}
        </Text>
      </Row>
    );
  }

  const isCollapsed = getJsonNodeCollapsedState(collapsed, path, depth);
  const children = getJsonChildren(value);
  const open = formatJsonContainerOpen(value);
  const close = formatJsonContainerClose(value);
  const canToggle = children.length > 0;

  return (
    <Col style={{ width: '100%', gap: 2 }}>
      <Pressable
        onPress={() => {
          if (canToggle) onToggle(path, depth);
        }}
        style={{
          width: '100%',
          minHeight: 22,
          justifyContent: 'center',
          paddingLeft: indent,
          paddingTop: 1,
          paddingBottom: 1,
          borderRadius: 6,
        }}
      >
        <Row style={{ width: '100%', alignItems: 'center', gap: 6 }}>
          <Text style={{ width: 12, fontFamily: 'monospace', fontSize: 10, color: PAGE_SURFACE.mutedTextColor }}>
            {canToggle ? (isCollapsed ? '▸' : '▾') : ' '}
          </Text>
          {name ? (
            <Text style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.textColor }}>
              {`${name}:`}
            </Text>
          ) : null}
          <Text style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.textColor }}>
            {open}
          </Text>
          <Text
            style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.mutedTextColor }}
          >
            {describeJsonValue(value)}
          </Text>
          {isCollapsed ? (
            <Text
              style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.textColor }}
            >
              {close}
            </Text>
          ) : null}
        </Row>
      </Pressable>

      {!isCollapsed && canToggle ? (
        <Col style={{ width: '100%', gap: 2 }}>
          {children.map(([childName, childValue]) => (
            <JsonTreeNode
              key={`${path}:${childName}`}
              name={childName}
              value={childValue}
              path={`${path}.${childName}`}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
          <Row
            style={{
              width: '100%',
              minHeight: 20,
              alignItems: 'center',
              paddingLeft: indent + 18,
            }}
          >
            <Text style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.textColor }}>
              {close}
            </Text>
          </Row>
        </Col>
      ) : null}
    </Col>
  );
}

function JsonDataPanel({
  label,
  tone,
  value,
}: {
  label: string;
  tone: string;
  value: unknown;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const setAllNested = (nextCollapsed: boolean) => {
    const nextState: Record<string, boolean> = {};

    const visit = (node: unknown, path: string, depth: number) => {
      if (!isJsonContainer(node)) return;
      nextState[path] = depth === 0 ? false : nextCollapsed;
      for (const [childName, childValue] of getJsonChildren(node)) {
        visit(childValue, `${path}.${childName}`, depth + 1);
      }
    };

    visit(value, 'root', 0);
    setCollapsed(nextState);
  };

  return (
    <Col
      style={{
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        gap: 8,
      }}
    >
      <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: tone }}>{label}</Text>
          <Text style={{ fontSize: 9, color: PAGE_SURFACE.mutedTextColor }}>{describeJsonValue(value)}</Text>
        </Row>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Pressable
            onPress={() => setAllNested(false)}
            style={{
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 4,
              paddingBottom: 4,
              borderRadius: CHIP_RADIUS,
              borderWidth: 1,
              borderColor: PAGE_SURFACE.borderColor,
              backgroundColor: PAGE_SURFACE.backgroundColor,
            }}
          >
            <Text style={{ fontSize: 8, fontWeight: 'bold', color: PAGE_SURFACE.mutedTextColor }}>Expand all</Text>
          </Pressable>
          <Pressable
            onPress={() => setAllNested(true)}
            style={{
              paddingLeft: 8,
              paddingRight: 8,
              paddingTop: 4,
              paddingBottom: 4,
              borderRadius: CHIP_RADIUS,
              borderWidth: 1,
              borderColor: PAGE_SURFACE.borderColor,
              backgroundColor: PAGE_SURFACE.backgroundColor,
            }}
          >
            <Text style={{ fontSize: 8, fontWeight: 'bold', color: PAGE_SURFACE.mutedTextColor }}>Collapse all</Text>
          </Pressable>
        </Row>
      </Row>
      <Box
        style={{
          width: '100%',
          borderRadius: 10,
          backgroundColor: PAGE_SURFACE.backgroundColor,
          borderWidth: 1,
          borderColor: PAGE_SURFACE.borderColor,
        }}
      >
        <ScrollView
          style={{
            width: '100%',
            maxHeight: 540,
            padding: 12,
          }}
          showScrollbar
        >
          {value != null ? (
            <JsonTreeNode
              value={value}
              path="root"
              depth={0}
              collapsed={collapsed}
              onToggle={(path, depth) => {
                setCollapsed((prev) => ({
                  ...prev,
                  [path]: !getJsonNodeCollapsedState(prev, path, depth),
                }));
              }}
            />
          ) : (
            <Text style={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 16, color: PAGE_SURFACE.mutedTextColor }}>
              null
            </Text>
          )}
        </ScrollView>
      </Box>
    </Col>
  );
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getJsonSchemaFieldNode(value: unknown): Record<string, unknown> | null {
  const root = jsonRecord(value);
  if (!root) return null;
  if (root.type === 'array') return jsonRecord(root.items) || root;
  return root;
}

function getJsonSchemaProperties(value: unknown): Array<[string, unknown]> {
  const node = getJsonSchemaFieldNode(value);
  if (!node) return [];
  const properties = node.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    return Object.entries(properties as Record<string, unknown>);
  }
  return getJsonSchemaPreviewFields(node).filter(([key]) => key !== '$schema' && key !== 'title' && key !== 'type');
}

function getJsonSchemaRequired(value: unknown): Set<string> {
  const node = getJsonSchemaFieldNode(value);
  const required = Array.isArray(node?.required) ? node?.required : [];
  return new Set(required.filter((item): item is string => typeof item === 'string'));
}

function getRefTail(value: string): string {
  const tail = value.split('/').filter(Boolean).pop() || value;
  return tail.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function classifySchemaNode(value: unknown): JsonSchemaPreviewKind {
  const node = jsonRecord(value);
  if (!node) {
    const leaf = describeJsonPreviewLeaf(value);
    if (leaf === 'boolean') return 'boolean';
    if (leaf === 'number') return 'number';
    if (leaf === 'string' || leaf === 'url' || leaf === 'ref') return 'string';
    return 'unknown';
  }

  if (typeof node.$ref === 'string') return 'ref';
  if (Array.isArray(node.enum)) return 'enum';
  if (Array.isArray(node.oneOf) || Array.isArray(node.anyOf) || Array.isArray(node.allOf)) return 'choice';

  const type = typeof node.type === 'string' ? node.type : '';
  if (type === 'array') return 'array';

  const properties = node.properties;
  const propertyCount =
    properties && typeof properties === 'object' && !Array.isArray(properties)
      ? Object.keys(properties as Record<string, unknown>).length
      : 0;
  if (type === 'object' || propertyCount > 0) return node.additionalProperties && propertyCount === 0 ? 'map' : 'object';
  if (type === 'string') return 'string';
  if (type === 'number') return 'number';
  if (type === 'integer') return 'integer';
  if (type === 'boolean') return 'boolean';
  return 'unknown';
}

function describeSchemaNode(value: unknown): string {
  const node = jsonRecord(value);
  if (!node) return describeJsonPreviewLeaf(value);

  if (typeof node.$ref === 'string') return `ref ${getRefTail(node.$ref)}`;
  if (Array.isArray(node.enum)) {
    const shown = node.enum.slice(0, 3).map((item) => String(item)).join('|');
    return `enum ${shown}${node.enum.length > 3 ? '|...' : ''}`;
  }
  if (Object.prototype.hasOwnProperty.call(node, 'const')) return `const ${describeJsonPreviewLeaf(node.const)}`;
  if (Array.isArray(node.oneOf)) return `oneOf ${node.oneOf.length}`;
  if (Array.isArray(node.anyOf)) return `anyOf ${node.anyOf.length}`;
  if (Array.isArray(node.allOf)) return `allOf ${node.allOf.length}`;

  const type = typeof node.type === 'string' ? node.type : '';
  if (type === 'array') {
    return `array ${describeSchemaNode(node.items || 'unknown')}`;
  }

  const properties = node.properties;
  const propertyCount =
    properties && typeof properties === 'object' && !Array.isArray(properties)
      ? Object.keys(properties as Record<string, unknown>).length
      : 0;
  if (type === 'object' || propertyCount > 0) {
    if (propertyCount > 0) return `object ${propertyCount}f`;
    return node.additionalProperties ? 'map' : 'object';
  }

  if (type) {
    const format = typeof node.format === 'string' ? `:${node.format}` : '';
    const min = typeof node.minimum === 'number' ? node.minimum : null;
    const max = typeof node.maximum === 'number' ? node.maximum : null;
    const range = min != null || max != null ? ` ${min ?? '*'}-${max ?? '*'}` : '';
    return `${type}${format}${range}`;
  }

  return describeJsonValue(node);
}

function schemaKindColor(kind: JsonSchemaPreviewKind | undefined): string {
  if (kind === 'array') return COLORS.compose;
  if (kind === 'object') return COLORS.accent;
  if (kind === 'map') return COLORS.warning;
  if (kind === 'enum') return COLORS.warning;
  if (kind === 'ref') return COLORS.muted;
  if (kind === 'boolean') return COLORS.success;
  if (kind === 'number' || kind === 'integer') return COLORS.warning;
  if (kind === 'choice') return COLORS.compose;
  return PAGE_SURFACE.textColor;
}

function schemaKindLabel(kind: JsonSchemaPreviewKind | undefined): string {
  if (!kind || kind === 'unknown') return '';
  return kind;
}

function getNestedSchemaProperties(value: unknown): Array<[string, unknown]> {
  const node = jsonRecord(value);
  if (!node) return [];
  const nested = node.type === 'array' ? jsonRecord(node.items) : node;
  const properties = nested?.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    return Object.entries(properties as Record<string, unknown>);
  }
  return [];
}

function collectSchemaPreviewRows(value: unknown): { rows: JsonPreviewRow[]; totalTopFields: number; requiredCount: number; rootType: string } {
  const rows: JsonPreviewRow[] = [];
  const topFields = getJsonSchemaProperties(value);
  const required = getJsonSchemaRequired(value);
  const root = jsonRecord(value);
  const rootType = root?.type === 'array' ? 'array<object>' : typeof root?.type === 'string' ? root.type : 'schema';

  for (const [fieldName, fieldValue] of topFields) {
    if (rows.length >= JSON_PREVIEW_MAX_ROWS) break;
    rows.push({
      key: fieldName,
      depth: 0,
      label: fieldName,
      value: describeSchemaNode(fieldValue),
      container: getNestedSchemaProperties(fieldValue).length > 0,
      required: required.has(fieldName),
      kind: classifySchemaNode(fieldValue),
    });

    if (rows.length >= JSON_PREVIEW_MAX_ROWS) break;
    const nested = getNestedSchemaProperties(fieldValue).slice(0, 2);
    for (const [childName, childValue] of nested) {
      if (rows.length >= JSON_PREVIEW_MAX_ROWS) break;
      rows.push({
        key: `${fieldName}.${childName}`,
        depth: 1,
        label: childName,
        value: describeSchemaNode(childValue),
        container: false,
        kind: classifySchemaNode(childValue),
      });
    }
  }

  return { rows, totalTopFields: topFields.length, requiredCount: required.size, rootType };
}

function JsonSchemaPreview({ value }: { value: unknown }) {
  const preview = collectSchemaPreviewRows(value);

  return (
    <Col style={{ width: '100%', height: '100%', padding: 7, gap: 2, backgroundColor: PAGE_SURFACE.backgroundColor, overflow: 'hidden' }}>
      <Row style={{ width: '100%', minHeight: 13, alignItems: 'center', gap: 5 }}>
        <Text style={{ fontFamily: 'monospace', fontSize: 8, fontWeight: 'bold', color: COLORS.accent }}>schema</Text>
        <Text numberOfLines={1} style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, fontFamily: 'monospace', fontSize: 8, color: PAGE_SURFACE.mutedTextColor }}>
          {`${preview.rootType} · ${preview.totalTopFields} fields · ${preview.requiredCount} req`}
        </Text>
      </Row>
      {preview.rows.map((row) => {
        const kind = schemaKindLabel(row.kind);
        const annotation = row.value && row.value !== kind ? ` · ${row.value}` : kind ? ` · ${kind}` : '';
        return (
          <Row
            key={row.key}
            style={{
              width: '100%',
              minHeight: 13,
              alignItems: 'center',
              gap: 4,
              paddingLeft: row.depth * 9,
            }}
          >
            <Box
              style={{
                width: 5,
                height: 8,
                borderRadius: 2,
                backgroundColor: schemaKindColor(row.kind),
                opacity: row.depth > 0 ? 0.72 : 1,
              }}
            />
            <Text
              numberOfLines={1}
              style={{
                flexGrow: 1,
                flexBasis: 0,
                minWidth: 0,
                fontFamily: 'monospace',
                fontSize: 8,
                lineHeight: 11,
                fontWeight: row.required ? 'bold' : 'normal',
                color: schemaKindColor(row.kind),
              }}
            >
              {`${row.required ? '*' : row.depth > 0 ? '-' : ''}${row.label}${annotation}`}
            </Text>
          </Row>
        );
      })}
      {preview.totalTopFields > preview.rows.filter((row) => row.depth === 0).length ? (
        <Text style={{ paddingLeft: 12, fontFamily: 'monospace', fontSize: 8, color: PAGE_SURFACE.mutedTextColor }}>
          {`+${preview.totalTopFields - preview.rows.filter((row) => row.depth === 0).length} fields`}
        </Text>
      ) : null}
    </Col>
  );
}

function DataReferencePanel({
  story,
  dataStoriesBySource,
  onSelectReference,
}: {
  story: GalleryDataStory;
  dataStoriesBySource: Map<string, StoryEntry>;
  onSelectReference: (entry: StoryEntry) => void;
}) {
  const references = getDataStoryReferences(story);
  if (references.length === 0) return null;

  return (
    <Col
      style={{
        width: '100%',
        padding: 12,
        gap: 8,
        borderRadius: 10,
        backgroundColor: PAGE_SURFACE.backgroundColor,
        borderWidth: 1,
        borderColor: PAGE_SURFACE.borderColor,
      }}
    >
      <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 10, fontWeight: 'bold', color: PAGE_SURFACE.mutedTextColor }}>LINKED SHAPES</Text>
        <Text style={{ fontSize: 9, color: PAGE_SURFACE.mutedTextColor }}>
          {`${references.length} ${references.length === 1 ? 'reference' : 'references'}`}
        </Text>
      </Row>

      <Col style={{ width: '100%', gap: 8 }}>
        {references.map((reference) => {
          const linkedStory = dataStoriesBySource.get(reference.targetSource) || null;
          const mapping =
            reference.sourceField && reference.targetField
              ? `${reference.sourceField} -> ${reference.targetField}`
              : reference.sourceField
                ? reference.sourceField
                : reference.targetField || '';

          const content = (
            <Col
              style={{
                width: '100%',
                padding: 10,
                gap: 4,
                borderRadius: 8,
                backgroundColor: PAGE_SURFACE.backgroundColor,
                borderWidth: 1,
                borderColor: PAGE_SURFACE.borderColor,
              }}
            >
              <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <Text style={{ fontSize: 10, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>
                  {reference.label}
                </Text>
                <MetaBadge
                  label={formatDataReferenceLabel(reference.kind)}
                  tone={COLORS.accent}
                  background={PAGE_SURFACE.backgroundColor}
                />
              </Row>
              <Text style={{ fontSize: 10, color: PAGE_SURFACE.mutedTextColor }}>
                {linkedStory ? linkedStory.story.title : getSourceLabel(reference.targetSource)}
              </Text>
              <Text style={{ fontFamily: 'monospace', fontSize: 9, color: PAGE_SURFACE.mutedTextColor }}>
                {reference.targetSource}
              </Text>
              {mapping ? (
                <Text style={{ fontFamily: 'monospace', fontSize: 9, color: PAGE_SURFACE.textColor }}>
                  {mapping}
                </Text>
              ) : null}
              {reference.summary ? (
                <Text style={{ fontSize: 9, color: PAGE_SURFACE.mutedTextColor }}>{reference.summary}</Text>
              ) : null}
              <Text style={{ fontSize: 8, color: linkedStory ? COLORS.accent : PAGE_SURFACE.mutedTextColor }}>
                {linkedStory ? 'Open linked shape' : 'No linked shape page yet'}
              </Text>
            </Col>
          );

          return linkedStory ? (
            <Pressable
              key={`${reference.kind}:${reference.targetSource}:${reference.label}`}
              onPress={() => onSelectReference(linkedStory)}
            >
              {content}
            </Pressable>
          ) : (
            <Box key={`${reference.kind}:${reference.targetSource}:${reference.label}`}>{content}</Box>
          );
        })}
      </Col>
    </Col>
  );
}

function DataStoryPreview({
  story,
  dataStoriesBySource,
  onSelectReference,
}: {
  story: GalleryDataStory;
  dataStoriesBySource: Map<string, StoryEntry>;
  onSelectReference: (entry: StoryEntry) => void;
}) {
  const storage = getDataStoryStorage(story);

  return (
    <Col
      style={{
        width: '100%',
        gap: 16,
        alignItems: 'stretch',
      }}
    >
      {story.summary ? (
        <Text style={{ fontSize: 12, lineHeight: 18, color: PAGE_SURFACE.mutedTextColor }}>{story.summary}</Text>
      ) : null}

      {storage.length > 0 ? (
        <Col
          style={{
            width: '100%',
            padding: 12,
            gap: 8,
            borderRadius: 10,
            backgroundColor: PAGE_SURFACE.backgroundColor,
            borderWidth: 1,
            borderColor: PAGE_SURFACE.borderColor,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: PAGE_SURFACE.mutedTextColor }}>STORAGE TARGET</Text>
          <Row style={{ width: '100%', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {storage.map((entry) => (
              <MetaBadge
                key={entry}
                label={formatStorageLabel(entry)}
                tone={PAGE_SURFACE.textColor}
                background={PAGE_SURFACE.backgroundColor}
              />
            ))}
          </Row>
        </Col>
      ) : null}

      <DataReferencePanel
        story={story}
        dataStoriesBySource={dataStoriesBySource}
        onSelectReference={onSelectReference}
      />

      <Row style={{ width: '100%', gap: 16, alignItems: 'flex-start' }}>
        <JsonDataPanel label="JSON Schema" tone={COLORS.warning} value={story.schema} />
        <JsonDataPanel label="Mock Data" tone={COLORS.success} value={story.mockData} />
      </Row>
    </Col>
  );
}

function isColorTokenValue(value: GalleryThemeTokenValue): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    /^#([0-9a-f]{3,8})$/i.test(trimmed) ||
    /^rgba?\(/i.test(trimmed) ||
    /^hsla?\(/i.test(trimmed) ||
    /^oklch\(/i.test(trimmed) ||
    /^oklab\(/i.test(trimmed)
  );
}

function formatThemeTokenValue(value: GalleryThemeTokenValue): string {
  return typeof value === 'string' ? value : String(value);
}

function ThemeTokenRow({
  name,
  value,
  scope,
}: {
  name: string;
  value: GalleryThemeTokenValue;
  scope?: 'global' | 'local';
}) {
  const colorToken = isColorTokenValue(value);

  return (
    <Row
      style={{
        width: '100%',
        minHeight: 34,
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingTop: 6,
        paddingBottom: 6,
        borderTopWidth: 1,
        borderTopColor: PAGE_SURFACE.borderColor,
      }}
    >
      <Row style={{ alignItems: 'center', gap: 10, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        {colorToken ? (
          <Box
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              backgroundColor: String(value),
              borderWidth: 1,
              borderColor: PAGE_SURFACE.borderColor,
            }}
          />
        ) : (
          <Box
            style={{
              minWidth: 18,
              height: 18,
              paddingLeft: 5,
              paddingRight: 5,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              backgroundColor: PAGE_SURFACE.backgroundColor,
              borderWidth: 1,
              borderColor: PAGE_SURFACE.borderColor,
            }}
          >
            <Text style={{ fontSize: 8, fontWeight: 'bold', color: PAGE_SURFACE.mutedTextColor }}>123</Text>
          </Box>
        )}
        <Text style={{ fontFamily: 'monospace', fontSize: 10, color: PAGE_SURFACE.textColor }}>{name}</Text>
      </Row>
      <Row style={{ alignItems: 'center', gap: 8 }}>
        {scope ? (
          <MetaBadge
            label={scope === 'local' ? 'Local' : 'Global'}
            tone={scope === 'local' ? COLORS.accent : PAGE_SURFACE.mutedTextColor}
            background={PAGE_SURFACE.backgroundColor}
          />
        ) : null}
        <Text style={{ fontFamily: 'monospace', fontSize: 10, color: PAGE_SURFACE.mutedTextColor }}>
          {formatThemeTokenValue(value)}
        </Text>
      </Row>
    </Row>
  );
}

function ThemeTokenCategoryPanel({
  title,
  tokens,
  scope,
}: {
  title: string;
  tokens: Array<{ name: string; value: GalleryThemeTokenValue; scope?: 'global' | 'local' }>;
  scope?: 'global' | 'local';
}) {
  return (
    <Col
      style={{
        width: '100%',
        padding: 12,
        gap: 2,
        borderRadius: 10,
        backgroundColor: PAGE_SURFACE.backgroundColor,
        borderWidth: 1,
        borderColor: PAGE_SURFACE.borderColor,
      }}
    >
      <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 11, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>{title}</Text>
        <Text style={{ fontSize: 9, color: PAGE_SURFACE.mutedTextColor }}>
          {`${tokens.length} ${tokens.length === 1 ? 'token' : 'tokens'}`}
        </Text>
      </Row>
      <Col style={{ width: '100%' }}>
        {tokens.map((token) => (
          <ThemeTokenRow
            key={`${title}:${token.name}`}
            name={token.name}
            value={token.value}
            scope={token.scope || scope}
          />
        ))}
      </Col>
    </Col>
  );
}

function ThemeClassifierPanel({ story }: { story: GalleryThemeStory }) {
  const classifiers = getThemeStoryClassifiers(story);

  return (
    <Col
      style={{
        width: '100%',
        padding: 12,
        gap: 8,
        borderRadius: 10,
        backgroundColor: PAGE_SURFACE.backgroundColor,
        borderWidth: 1,
        borderColor: PAGE_SURFACE.borderColor,
      }}
    >
      <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 10, fontWeight: 'bold', color: PAGE_SURFACE.mutedTextColor }}>CLASSIFIER FILES</Text>
        <Text style={{ fontSize: 9, color: PAGE_SURFACE.mutedTextColor }}>
          {`${classifiers.length} ${classifiers.length === 1 ? 'file' : 'files'}`}
        </Text>
      </Row>
      <Col style={{ width: '100%', gap: 8 }}>
        {classifiers.map((classifier) => (
          <Col
            key={`${classifier.kind}:${classifier.source}`}
            style={{
              width: '100%',
              padding: 10,
              gap: 4,
              borderRadius: 8,
              backgroundColor: PAGE_SURFACE.backgroundColor,
              borderWidth: 1,
              borderColor: PAGE_SURFACE.borderColor,
            }}
          >
            <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Text style={{ fontSize: 10, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>
                {classifier.label || formatThemeClassifierLabel(classifier.kind)}
              </Text>
              <MetaBadge
                label={formatThemeClassifierLabel(classifier.kind)}
                tone={COLORS.accent}
                background={PAGE_SURFACE.backgroundColor}
              />
            </Row>
            <Text style={{ fontFamily: 'monospace', fontSize: 9, color: PAGE_SURFACE.mutedTextColor }}>
              {classifier.source}
            </Text>
          </Col>
        ))}
      </Col>
    </Col>
  );
}

function ThemeVariantPanel({
  theme,
  globalTokens,
  active,
  onApply,
}: {
  theme: GalleryThemeVariant;
  globalTokens: GalleryThemeStory['globalTokens'];
  active?: boolean;
  onApply?: (() => void) | null;
}) {
  const mergedCategories = mergeThemeTokenCategories(globalTokens, theme.tokens);

  return (
    <Col
      style={{
        width: '100%',
        padding: 14,
        gap: 12,
        borderRadius: 10,
        backgroundColor: PAGE_SURFACE.backgroundColor,
        borderWidth: 1,
        borderColor: PAGE_SURFACE.borderColor,
      }}
    >
      <Col style={{ gap: 4 }}>
        <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Row style={{ alignItems: 'center', gap: 8, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
            <Text style={{ fontSize: 12, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>{theme.title}</Text>
            {active ? (
              <MetaBadge label="Active" tone={COLORS.accent} background={PAGE_SURFACE.backgroundColor} />
            ) : null}
          </Row>
          <Row style={{ alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 9, color: PAGE_SURFACE.mutedTextColor }}>
              {`${countThemeTokens(theme.tokens)} local override${countThemeTokens(theme.tokens) === 1 ? '' : 's'}`}
            </Text>
            {onApply ? (
              <Pressable
                onPress={onApply}
                style={{
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 4,
                  paddingBottom: 4,
                  borderRadius: CHIP_RADIUS,
                  borderWidth: 1,
                  borderColor: active ? COLORS.accent : PAGE_SURFACE.borderColor,
                  backgroundColor: PAGE_SURFACE.backgroundColor,
                }}
              >
                <Text style={{ fontSize: 8, fontWeight: 'bold', color: active ? COLORS.accent : PAGE_SURFACE.textColor }}>
                  {active ? 'Applied' : 'Apply Globally'}
                </Text>
              </Pressable>
            ) : null}
          </Row>
        </Row>
        {theme.summary ? (
          <Text style={{ fontSize: 10, color: PAGE_SURFACE.mutedTextColor }}>{theme.summary}</Text>
        ) : null}
      </Col>

      <Col style={{ width: '100%', gap: 10 }}>
        {mergedCategories.map((category) => (
          <ThemeTokenCategoryPanel key={category.id} title={category.title} tokens={category.tokens} />
        ))}
      </Col>
    </Col>
  );
}

function ThemeStoryPreview({
  story,
  activeThemeId,
  onApplyTheme,
}: {
  story: GalleryThemeStory;
  activeThemeId: string;
  onApplyTheme: (id: string) => void;
}) {
  const globalTokenCount = countThemeTokens(story.globalTokens);
  const themeVariants = getThemeStoryVariants(story);

  return (
    <Col
      style={{
        width: '100%',
        gap: 16,
        alignItems: 'stretch',
      }}
    >
      {story.summary ? (
        <Text style={{ fontSize: 12, lineHeight: 18, color: PAGE_SURFACE.mutedTextColor }}>{story.summary}</Text>
      ) : null}

      <Row style={{ width: '100%', gap: 12, alignItems: 'stretch' }}>
        <Col
          style={{
            flexGrow: 1,
            flexBasis: 0,
            padding: 12,
            gap: 4,
            borderRadius: 10,
            backgroundColor: PAGE_SURFACE.backgroundColor,
            borderWidth: 1,
            borderColor: PAGE_SURFACE.borderColor,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: PAGE_SURFACE.mutedTextColor }}>GLOBAL TOKENS</Text>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>{String(globalTokenCount)}</Text>
        </Col>
        <Col
          style={{
            flexGrow: 1,
            flexBasis: 0,
            padding: 12,
            gap: 4,
            borderRadius: 10,
            backgroundColor: PAGE_SURFACE.backgroundColor,
            borderWidth: 1,
            borderColor: PAGE_SURFACE.borderColor,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: PAGE_SURFACE.mutedTextColor }}>THEME VARIANTS</Text>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>{String(themeVariants.length)}</Text>
        </Col>
        <Col
          style={{
            flexGrow: 1,
            flexBasis: 0,
            padding: 12,
            gap: 4,
            borderRadius: 10,
            backgroundColor: PAGE_SURFACE.backgroundColor,
            borderWidth: 1,
            borderColor: PAGE_SURFACE.borderColor,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: 'bold', color: PAGE_SURFACE.mutedTextColor }}>CLASSIFIER FILES</Text>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>
            {String(getThemeStoryClassifiers(story).length)}
          </Text>
        </Col>
      </Row>

      <ThemeClassifierPanel story={story} />

      <Col style={{ width: '100%', gap: 10 }}>
        <Text style={{ fontSize: 11, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>Shared Global Tokens</Text>
        {story.globalTokens.map((category) => (
          <ThemeTokenCategoryPanel
            key={category.id}
            title={category.title}
            scope="global"
            tokens={Object.entries(category.tokens || {}).map(([name, value]) => ({ name, value }))}
          />
        ))}
      </Col>

      <Col style={{ width: '100%', gap: 12 }}>
        <Text style={{ fontSize: 11, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>Theme Variants</Text>
        {themeVariants.map((theme) => {
          const option = findGalleryThemeOption(story.source, theme.id);
          return (
            <ThemeVariantPanel
              key={theme.id}
              theme={theme}
              globalTokens={story.globalTokens}
              active={option ? option.id === activeThemeId : false}
              onApply={option ? () => onApplyTheme(option.id) : null}
            />
          );
        })}
      </Col>
    </Col>
  );
}

function getNextGalleryRouteId(path: string): NextGalleryRouteId | null {
  if (path === '/') return 'data';
  for (const route of NEXT_GALLERY_ROUTES) {
    if (path === route.path || path.startsWith(`${route.path}/`)) return route.id;
  }
  return null;
}

function NextGalleryRouteBar({
  backgroundColor,
  panelColor,
  panelRaisedColor,
  borderColor,
  textColor,
  mutedTextColor,
  accentColor,
}: {
  backgroundColor: string;
  panelColor: string;
  panelRaisedColor: string;
  borderColor: string;
  textColor: string;
  mutedTextColor: string;
  accentColor: string;
}) {
  const nav = useNavigate();
  const route = useRoute();
  const activeRouteId = getNextGalleryRouteId(route.path);

  return (
    <Row
      style={{
        width: '100%',
        height: 34,
        alignItems: 'center',
        backgroundColor: panelColor,
        borderBottomWidth: 1,
        borderBottomColor: borderColor,
      }}
    >
      {NEXT_GALLERY_ROUTES.map((item) => {
        const active = activeRouteId === item.id;
        return (
          <Pressable
            key={item.id}
            onPress={() => nav.push(item.path)}
            style={{
              width: '25%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? panelRaisedColor : panelColor,
              borderRightWidth: item.id === 'tokens' ? 0 : 1,
              borderRightColor: borderColor,
              borderBottomWidth: active ? 2 : 0,
              borderBottomColor: accentColor,
            }}
          >
            <Box
              style={{
                position: 'absolute',
                left: 12,
                right: 12,
                top: 5,
                height: 1,
                backgroundColor: active ? accentColor : borderColor,
              }}
            />
            <Text
              style={{
                fontSize: 11,
                fontWeight: active ? 'bold' : 'normal',
                color: active ? textColor : mutedTextColor,
                letterSpacing: 0.6,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </Row>
  );
}

function NextGalleryIndividualTabs({
  categoryId,
  entries,
  totalCount,
  selectedStoryId,
  onSelect,
  panelColor,
  panelRaisedColor,
  borderColor,
  textColor,
  mutedTextColor,
  accentColor,
}: {
  categoryId: NextGalleryRouteId;
  entries: StoryEntry[];
  totalCount: number;
  selectedStoryId: string;
  onSelect: (storyId: string) => void;
  panelColor: string;
  panelRaisedColor: string;
  borderColor: string;
  textColor: string;
  mutedTextColor: string;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [categoryId, entries.length, totalCount]);

  const allTabs = [
    {
      id: 'all',
      storyId: 'all',
      label: `All ${entries.length}/${totalCount}`,
    },
    ...entries.map((entry) => ({
      id: entry.story.id,
      storyId: entry.story.id,
      label: formatNextGalleryTabLabel(entry.story.title),
    })),
  ];
  const needsExpand = allTabs.length > NEXT_GALLERY_FILTER_COLUMNS;
  const collapsedVisibleCount = needsExpand ? NEXT_GALLERY_FILTER_COLUMNS - 1 : NEXT_GALLERY_FILTER_COLUMNS;
  const visibleTabs = expanded || !needsExpand ? allTabs : allTabs.slice(0, collapsedVisibleCount);
  const hiddenCount = Math.max(0, allTabs.length - collapsedVisibleCount);
  const renderTab = (tab: { id: string; storyId: string; label: string }) => {
    const active = selectedStoryId === tab.storyId;
    return (
      <Pressable
        key={tab.id}
        onPress={() => onSelect(tab.storyId)}
        style={{
          width: NEXT_GALLERY_FILTER_TAB_WIDTH,
          height: NEXT_GALLERY_FILTER_ROW_HEIGHT,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? panelRaisedColor : panelColor,
          borderRightWidth: 1,
          borderRightColor: borderColor,
          borderBottomWidth: active ? 2 : 0,
          borderBottomColor: accentColor,
        }}
      >
        <Box
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            top: 5,
            height: 1,
            backgroundColor: active ? accentColor : borderColor,
          }}
        />
        <Text
          numberOfLines={1}
          style={{
            fontSize: 10,
            fontWeight: active ? 'bold' : 'normal',
            color: active ? textColor : mutedTextColor,
            letterSpacing: 0.4,
          }}
        >
          {tab.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Col
      style={{
        width: '100%',
        backgroundColor: panelColor,
        borderBottomWidth: 1,
        borderBottomColor: borderColor,
      }}
    >
      <Row
        style={{
          width: '100%',
          minHeight: NEXT_GALLERY_FILTER_ROW_HEIGHT,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        {visibleTabs.map(renderTab)}
        {needsExpand ? (
          <Pressable
            onPress={() => setExpanded((value) => !value)}
            style={{
              width: NEXT_GALLERY_FILTER_TAB_WIDTH,
              height: NEXT_GALLERY_FILTER_ROW_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: expanded ? panelRaisedColor : panelColor,
              borderRightWidth: 1,
              borderRightColor: borderColor,
              borderBottomWidth: expanded ? 2 : 0,
              borderBottomColor: accentColor,
            }}
          >
            <Box
              style={{
                position: 'absolute',
                left: 8,
                right: 8,
                top: 5,
                height: 1,
                backgroundColor: expanded ? accentColor : borderColor,
              }}
            />
            <Text
              numberOfLines={1}
              style={{
                fontSize: 10,
                fontWeight: 'bold',
                color: expanded ? textColor : mutedTextColor,
                letterSpacing: 0.4,
              }}
            >
              {expanded ? 'Less' : `More +${hiddenCount}`}
            </Text>
          </Pressable>
        ) : null}
      </Row>
    </Col>
  );
}

function NextGallerySummaryCard({
  entry,
  categoryId,
  index,
  onSelect,
}: {
  entry: StoryEntry;
  categoryId: NextGalleryRouteId;
  index: number;
  onSelect: () => void;
}) {
  const variant = getStoryVariants(entry.story)[0] || null;
  const canvas = resolvePreviewCanvas(categoryId, entry.story, variant);
  const scale = getGridPreviewScale(canvas);
  const stagePadding = NEXT_GALLERY_GRID_CARD.stagePadding;
  // Bisect dial: tiles outside VARIANT_RANGE render placeholder regardless
  // of PERF_BUDGET. Lets us narrow which atoms are paying the per-frame cost.
  const inRange = index >= VARIANT_RANGE[0] && index < VARIANT_RANGE[1];
  const effectiveBudget = inRange ? PERF_BUDGET : 999;
  return (
    <Pressable onPress={onSelect}>
      {/* One StaticSurface per tile — caches the WHOLE thing (frame chrome,
          title, code, meta, AND the rendered preview) into a single GPU
          texture. Drops per-tile node cost in the grid from "every Text +
          Box in every tile" down to one quad per tile. The
          subtree-mutation invalidation patch handles re-capture if any
          descendant ever changes (favorite, theme swap, etc.). */}
      <StaticSurface
        staticKey={`gallery-tile:${entry.story.id}`}
        introFrames={30}
      >
        <GalleryDisplayContainer
          code={formatNextGalleryCode(categoryId, index)}
          title={entry.story.title}
          meta={getSourceName(entry.story.source)}
          ratio="compact"
          stagePadding={stagePadding}
          center
        >
          {variant ? (
            effectiveBudget === 0 ? (
              // Empty placeholder Box, sized to the scaled canvas footprint.
              <Box
                style={{
                  width: canvas.width * scale,
                  height: canvas.height * scale,
                  backgroundColor: '#1a1a1d',
                  borderRadius: 6,
                }}
              />
            ) : effectiveBudget === 1 ? (
              // variant.render() inside a flex-centered, un-scaled box.
              <Box
                style={{
                  width: canvas.width * scale,
                  height: canvas.height * scale,
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ChartAnimationProvider disabled>
                  {variant.render()}
                </ChartAnimationProvider>
              </Box>
            ) : (
              // Full layout-and-scale pipeline.
              <Box
                style={{
                  width: canvas.width * scale,
                  height: canvas.height * scale,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <Box
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: canvas.width,
                    height: canvas.height,
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: { scaleX: scale, scaleY: scale, originX: 0, originY: 0 },
                  }}
                >
                  <ChartAnimationProvider disabled>
                    {variant.render()}
                  </ChartAnimationProvider>
                </Box>
              </Box>
            )
          ) : (
            isDataStory(entry.story) ? (
              <JsonSchemaPreview value={entry.story.schema} />
            ) : (
              <Col style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>{getStoryTypeLabel(entry)}</Text>
                <Text numberOfLines={2} style={{ fontSize: 9, color: PAGE_SURFACE.mutedTextColor }}>
                  {entry.story.summary || entry.story.source}
                </Text>
              </Col>
            )
          )}
        </GalleryDisplayContainer>
      </StaticSurface>
    </Pressable>
  );
}

function NextGalleryDetailCard({
  entry,
  categoryId,
  index,
  dataStoriesBySource,
  activeThemeId,
  onApplyTheme,
  onSelectReference,
}: {
  entry: StoryEntry;
  categoryId: NextGalleryRouteId;
  index: number;
  dataStoriesBySource: Map<string, StoryEntry>;
  activeThemeId: string;
  onApplyTheme: (id: string) => void;
  onSelectReference: (entry: StoryEntry) => void;
}) {
  const story = entry.story;
  const centered = !isDataStory(story) && !isThemeStory(story);
  const code = formatNextGalleryCode(categoryId, index);
  const meta = getSourceName(story.source);

  if (isDataStory(story)) {
    return (
      <GalleryDisplayContainer
        code={code}
        title={story.title}
        meta={meta}
        ratio="fluid"
        width="100%"
        height="100%"
        stagePadding={12}
        center={false}
      >
        <DataStoryPreview story={story} dataStoriesBySource={dataStoriesBySource} onSelectReference={onSelectReference} />
      </GalleryDisplayContainer>
    );
  }

  if (isThemeStory(story)) {
    return (
      <GalleryDisplayContainer
        code={code}
        title={story.title}
        meta={meta}
        ratio="fluid"
        width="100%"
        height="100%"
        stagePadding={12}
        center={false}
      >
        <ThemeStoryPreview story={story} activeThemeId={activeThemeId} onApplyTheme={onApplyTheme} />
      </GalleryDisplayContainer>
    );
  }

  const variants = getStoryVariants(story);
  if (variants.length === 0) {
    return (
      <GalleryDisplayContainer
        code={code}
        title={story.title}
        meta={meta}
        ratio="wide"
        width="100%"
        height={520}
        stagePadding={18}
        center
      >
        <EmptyPreview />
      </GalleryDisplayContainer>
    );
  }

  if (variants.length === 1) {
    const v = variants[0];
    return (
      <GalleryDisplayContainer
        code={code}
        title={story.title}
        meta={meta}
        ratio="wide"
        width="100%"
        height={520}
        stagePadding={centered ? 18 : 12}
        center={centered}
      >
        {v.render()}
      </GalleryDisplayContainer>
    );
  }

  const fallback = variants.length === 2
    ? { width: 540, height: 440 }
    : { width: 720, height: 420 };
  return (
    <Row style={{ width: '100%', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {variants.map((variant, vi) => {
        const canvas = variant.previewCanvas || fallback;
        return (
          <GalleryDisplayContainer
            key={variant.id}
            code={`${code}.${vi + 1}`}
            title={`${story.title} · ${variant.name}`}
            meta={meta}
            ratio="fluid"
            width={canvas.width}
            height={canvas.height}
            stagePadding={centered ? 12 : 8}
            center={centered}
          >
            {variant.render()}
          </GalleryDisplayContainer>
        );
      })}
    </Row>
  );
}

function getNextGalleryGridGeometry(containerW: number, totalCount: number) {
  const tileW = NEXT_GALLERY_GRID_CARD.width;
  const tileH = NEXT_GALLERY_GRID_CARD.height;
  const gap = NEXT_GALLERY_GRID_CARD.gap;
  const pad = NEXT_GALLERY_GRID_CARD.pagePadding;
  const innerW = Math.max(tileW, containerW - pad * 2);
  const cols = Math.max(1, Math.floor((innerW + gap) / (tileW + gap)));
  const rowStride = tileH + gap;
  const totalRows = Math.ceil(totalCount / cols);
  const totalH = totalRows > 0 ? totalRows * rowStride - gap + pad * 2 : 0;
  const usedW = cols * tileW + Math.max(0, cols - 1) * gap;
  const leftPad = pad + Math.max(0, (innerW - usedW) / 2);
  return { tileW, tileH, gap, pad, cols, rowStride, totalRows, totalH, leftPad };
}

function VirtualizedTileGrid({
  entries,
  allEntries,
  categoryId,
  containerW,
  viewportH,
  scrollY,
  onSelectStory,
}: {
  entries: StoryEntry[];
  allEntries: StoryEntry[];
  categoryId: NextGalleryRouteId;
  containerW: number;
  viewportH: number;
  scrollY: number;
  onSelectStory: (categoryId: NextGalleryRouteId, storyId: string) => void;
}) {
  const geom = getNextGalleryGridGeometry(containerW, entries.length);
  const firstRow = Math.max(
    0,
    Math.floor((scrollY - geom.pad) / geom.rowStride) - VIRTUAL_BUFFER_ROWS
  );
  const lastRow = Math.min(
    Math.max(0, geom.totalRows - 1),
    Math.floor((scrollY + viewportH - geom.pad) / geom.rowStride) + VIRTUAL_BUFFER_ROWS
  );

  const tiles: any[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let col = 0; col < geom.cols; col += 1) {
      const i = row * geom.cols + col;
      if (i < 0 || i >= entries.length) continue;
      const entry = entries[i];
      const left = geom.leftPad + col * (geom.tileW + geom.gap);
      const top = geom.pad + row * geom.rowStride;
      tiles.push(
        <Box
          key={entry.story.id}
          style={{
            position: 'absolute',
            left,
            top,
            width: geom.tileW,
            height: geom.tileH,
          }}
        >
          <NextGallerySummaryCard
            entry={entry}
            categoryId={categoryId}
            index={Math.max(
              0,
              allEntries.findIndex((candidate) => candidate.story.id === entry.story.id)
            )}
            onSelect={() => onSelectStory(categoryId, entry.story.id)}
          />
        </Box>
      );
    }
  }

  return (
    <Box style={{ width: '100%', height: geom.totalH, position: 'relative' }}>
      {tiles}
    </Box>
  );
}

// AtomsBrowser — two-column hover-to-preview replacement for the atoms
// grid. Left column is a scrollable list of every atom (name + source
// path). Hovering a row sets `hoveredId`, which causes the right column
// to mount that atom's variants and unmount the previous one. Only ONE
// atom is mounted at any time, so atom mount cost is amortized to a
// single tile rather than the whole catalog.
function AtomsBrowser({
  entries,
  allEntries,
  dataStoriesBySource,
  activeThemeId,
  onApplyTheme,
  onSelectReference,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search gallery',
}: {
  entries: StoryEntry[];
  allEntries: StoryEntry[];
  dataStoriesBySource: Map<string, StoryEntry>;
  activeThemeId: string;
  onApplyTheme: (id: string) => void;
  onSelectReference: (entry: StoryEntry) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredEntry = hoveredId
    ? entries.find((entry) => entry.story.id === hoveredId) || null
    : null;
  const hoveredCategoryId = hoveredEntry ? getNextGalleryCategory(hoveredEntry) : 'atoms';

  return (
    <Row style={{ width: '100%', height: '100%', alignItems: 'stretch', padding: 0, gap: 0 }}>
      <Col
        style={{
          width: 320,
          height: '100%',
          flexShrink: 0,
          borderRightWidth: 1,
          borderRightColor: PAGE_SURFACE.borderColor,
        }}
      >
        <Row
          style={{
            width: '100%',
            height: 32,
            alignItems: 'center',
            gap: 8,
            paddingLeft: 12,
            paddingRight: 8,
            borderBottomWidth: 1,
            borderBottomColor: PAGE_SURFACE.borderColor,
          }}
        >
          <Text style={{ width: 30, fontSize: 9, fontWeight: 'bold', color: COLORS.faint }}>Find</Text>
          <TextInput
            value={searchValue || ''}
            onChangeText={(value: any) => onSearchChange(getTextInputValue(value))}
            placeholder={searchPlaceholder}
            fontSize={11}
            color={COLORS.text}
            style={{
              height: 22,
              flexGrow: 1,
              flexBasis: 0,
              minWidth: 0,
              paddingLeft: 0,
              paddingRight: 0,
              backgroundColor: 'transparent',
              fontSize: 11,
              fontFamily: 'monospace',
              color: COLORS.text,
            }}
          />
        </Row>
        <ScrollView showScrollbar style={{ width: '100%', height: '100%' }}>
          <Col style={{ width: '100%', paddingTop: 6, paddingBottom: 6 }}>
            {entries.map((entry) => {
              const active = hoveredId === entry.story.id;
              return (
                <Pressable
                  key={entry.story.id}
                  onHoverEnter={() => setHoveredId(entry.story.id)}
                  onPress={() => setHoveredId(entry.story.id)}
                  style={{
                    width: '100%',
                    paddingLeft: 12,
                    paddingRight: 12,
                    paddingTop: 6,
                    paddingBottom: 6,
                    backgroundColor: active ? PAGE_SURFACE.backgroundColor : 'transparent',
                    borderLeftWidth: 2,
                    borderLeftColor: active ? COLORS.accent : 'transparent',
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 11,
                      fontWeight: active ? 'bold' : 'normal',
                      color: active ? PAGE_SURFACE.textColor : COLORS.muted,
                    }}
                  >
                    {entry.story.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 9,
                      color: COLORS.faint,
                      fontFamily: 'monospace',
                      paddingTop: 1,
                    }}
                  >
                    {entry.story.source}
                  </Text>
                </Pressable>
              );
            })}
          </Col>
        </ScrollView>
      </Col>
      <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: '100%' }}>
        {hoveredEntry ? (
          <ScrollView showScrollbar style={{ width: '100%', height: '100%' }}>
            <Col style={{ width: '100%', padding: 18 }}>
              <NextGalleryDetailCard
                entry={hoveredEntry}
                categoryId={hoveredCategoryId}
                index={Math.max(
                  0,
                  allEntries.findIndex((entry) => entry.story.id === hoveredEntry.story.id)
                )}
                dataStoriesBySource={dataStoriesBySource}
                activeThemeId={activeThemeId}
                onApplyTheme={onApplyTheme}
                onSelectReference={onSelectReference}
              />
            </Col>
          </ScrollView>
        ) : (
          <Col
            style={{
              flexGrow: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>
              {`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
            </Text>
            <Text style={{ fontSize: 11, color: PAGE_SURFACE.mutedTextColor }}>
              Hover an entry on the left to preview.
            </Text>
          </Col>
        )}
      </Col>
    </Row>
  );
}

function NextGalleryCollection({
  categoryId,
  entries,
  allEntries,
  selectedStoryId,
  dataStoriesBySource,
  activeThemeId,
  onApplyTheme,
  onSelectStory,
  containerW,
  viewportH,
  scrollY,
}: {
  categoryId: NextGalleryRouteId;
  entries: StoryEntry[];
  allEntries: StoryEntry[];
  selectedStoryId: string;
  dataStoriesBySource: Map<string, StoryEntry>;
  activeThemeId: string;
  onApplyTheme: (id: string) => void;
  onSelectStory: (categoryId: NextGalleryRouteId, storyId: string) => void;
  containerW: number;
  viewportH: number;
  scrollY: number;
}) {
  const selectedEntry =
    selectedStoryId === 'all' ? null : entries.find((entry) => entry.story.id === selectedStoryId) || null;

  if (entries.length === 0) {
    return (
      <Col style={{ width: '100%', padding: 18, gap: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: 'bold', color: PAGE_SURFACE.textColor }}>No matches</Text>
        <Text style={{ fontSize: 11, color: PAGE_SURFACE.mutedTextColor }}>Adjust the chrome search or switch filters.</Text>
      </Col>
    );
  }

  if (selectedEntry) {
    return (
      <Col style={{ width: '100%', padding: 18 }}>
        <NextGalleryDetailCard
          entry={selectedEntry}
          categoryId={categoryId}
          index={Math.max(0, allEntries.findIndex((entry) => entry.story.id === selectedEntry.story.id))}
          dataStoriesBySource={dataStoriesBySource}
          activeThemeId={activeThemeId}
          onApplyTheme={onApplyTheme}
          onSelectReference={(entry) => onSelectStory('data', entry.story.id)}
        />
      </Col>
    );
  }

  return (
    <VirtualizedTileGrid
      entries={entries}
      allEntries={allEntries}
      categoryId={categoryId}
      containerW={containerW}
      viewportH={viewportH}
      scrollY={scrollY}
      onSelectStory={onSelectStory}
    />
  );
}

function NextComponentGalleryShell({ selection: _selection }: { selection: Selection | null }) {
  const galleryTheme = useGalleryTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const tokens = galleryTheme.active?.tokensByPath;
  const backgroundColor = getThemeStringToken(tokens, 'surfaces.bg', COLORS.appBg);
  const stories = useMemo(() => sortStoryEntries(flattenStories(gallerySections)), []);
  const storyFuzzyOptions = useMemo<FuzzySearchOptions<StoryEntry>>(
    () => ({
      mode: NAV_SEARCH_MODE,
      getCandidates: getSearchCandidates,
      sort: (left: FuzzySearchResult<StoryEntry>, right: FuzzySearchResult<StoryEntry>) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.item.story.title.localeCompare(right.item.story.title);
      },
    }),
    []
  );
  const searchedMatches = useFuzzySearch(stories, searchQuery, storyFuzzyOptions);
  const searchedEntries = useMemo(() => searchedMatches.map((match) => match.item), [searchedMatches]);
  const dataStoriesBySource = useMemo(() => {
    const entries = new Map<string, StoryEntry>();
    for (const entry of stories) {
      if (!isDataStory(entry.story)) continue;
      if (!entries.has(entry.story.source)) entries.set(entry.story.source, entry);
    }
    return entries;
  }, [stories]);

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor }}>
      <AtomsBrowser
        entries={searchedEntries}
        allEntries={stories}
        dataStoriesBySource={dataStoriesBySource}
        activeThemeId={galleryTheme.activeThemeId}
        onApplyTheme={galleryTheme.setTheme}
        onSelectReference={() => {}}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
      />
    </Col>
  );
}

function ActiveComponentGalleryShell({ selection }: { selection: Selection | null }) {
  if (USE_EMPTY_GALLERY_SHELL) return <NextComponentGalleryShell selection={selection} />;
  return <ComponentGalleryShell selection={selection} />;
}

function ComponentGalleryShell({ selection }: { selection: Selection | null }) {
  const galleryTheme = useGalleryTheme();
  const nav = useNavigate();
  const stories = useMemo(() => flattenStories(gallerySections), []);
  const navigationStories = useMemo(() => sortStoryEntries(stories), [stories]);
  const allGroupFilters = useMemo(() => collectGroupFilters(stories), [stories]);
  const allTagFilters = useMemo(() => collectTagFilters(stories), [stories]);
  const variantCount = useMemo(() => countVariants(stories), [stories]);
  const topLevelCount = useMemo(() => countStoriesByKind(stories, 'top-level'), [stories]);
  const activeGalleryThemeIndex = useMemo(
    () => galleryTheme.options.findIndex((option) => option.id === galleryTheme.activeThemeId),
    [galleryTheme.activeThemeId, galleryTheme.options]
  );
  const [navQuery, setNavQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | GallerySectionKind>('all');
  const [groupFilter, setGroupFilter] = useState<'all' | string>('all');
  const [tagFilter, setTagFilter] = useState<'all' | string>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const updateNavQuery = (value: any) => {
    setNavQuery(getTextInputValue(value));
  };
  const filters = useMemo<NavigationFilters>(
    () => ({
      kind: kindFilter,
      groupId: groupFilter,
      tag: tagFilter,
    }),
    [groupFilter, kindFilter, tagFilter]
  );
  const storyFuzzyOptions = useMemo<FuzzySearchOptions<StoryEntry>>(
    () => ({
      mode: NAV_SEARCH_MODE,
      getCandidates: getSearchCandidates,
      sort: (left: FuzzySearchResult<StoryEntry>, right: FuzzySearchResult<StoryEntry>) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.item.story.title.localeCompare(right.item.story.title);
      },
    }),
    []
  );
  const visibleStoryBase = useMemo(
    () => filterStoryEntriesByFilters(navigationStories, filters),
    [filters, navigationStories]
  );
  const kindScopedStoryBase = useMemo(
    () =>
      filterStoryEntriesByFilters(navigationStories, {
        kind: 'all',
        groupId: groupFilter,
        tag: tagFilter,
      }),
    [groupFilter, navigationStories, tagFilter]
  );
  const groupScopedStoryBase = useMemo(
    () =>
      filterStoryEntriesByFilters(navigationStories, {
        kind: kindFilter,
        groupId: 'all',
        tag: tagFilter,
      }),
    [kindFilter, navigationStories, tagFilter]
  );
  const tagScopedStoryBase = useMemo(
    () =>
      filterStoryEntriesByFilters(navigationStories, {
        kind: kindFilter,
        groupId: groupFilter,
        tag: 'all',
      }),
    [groupFilter, kindFilter, navigationStories]
  );
  const visibleStoryMatches = useFuzzySearch(visibleStoryBase, navQuery, storyFuzzyOptions);
  const kindScopedStoryMatches = useFuzzySearch(kindScopedStoryBase, navQuery, storyFuzzyOptions);
  const groupScopedStoryMatches = useFuzzySearch(groupScopedStoryBase, navQuery, storyFuzzyOptions);
  const tagScopedStoryMatches = useFuzzySearch(tagScopedStoryBase, navQuery, storyFuzzyOptions);
  const visibleStories = useMemo(() => visibleStoryMatches.map((match) => match.item), [visibleStoryMatches]);
  const kindScopedStories = useMemo(() => kindScopedStoryMatches.map((match) => match.item), [kindScopedStoryMatches]);
  const groupScopedStories = useMemo(() => groupScopedStoryMatches.map((match) => match.item), [groupScopedStoryMatches]);
  const tagScopedStories = useMemo(() => tagScopedStoryMatches.map((match) => match.item), [tagScopedStoryMatches]);
  const kindFilterOptions = useMemo(
    () =>
      ([
        { id: 'top-level' as const, label: 'Top-Level', count: countStoriesByKind(kindScopedStories, 'top-level') },
        { id: 'atom' as const, label: 'Atoms', count: countStoriesByKind(kindScopedStories, 'atom') },
      ]).filter((option) => option.count > 0 || kindFilter === option.id),
    [kindFilter, kindScopedStories]
  );
  const groupFilters = useMemo(() => collectGroupFilters(groupScopedStories), [groupScopedStories]);
  const tagFilters = useMemo(() => collectTagFilters(tagScopedStories), [tagScopedStories]);
  const fallbackStories = visibleStories.length > 0 ? visibleStories : stories;
  const routedActive = useMemo(() => pickRoutedSelection(stories, selection), [stories, selection]);
  const fallbackActive = useMemo(() => pickSelection(fallbackStories, null), [fallbackStories]);
  const active = routedActive.entry ? routedActive : fallbackActive;
  const trimmedNavQuery = navQuery.trim();
  const visibleNavCategories = useMemo(
    () => groupVisibleStories(visibleStories, trimmedNavQuery.length > 0),
    [trimmedNavQuery, visibleStories]
  );
  const navListKey = `nav:${trimmedNavQuery.toLowerCase()}:${kindFilter}:${groupFilter}:${tagFilter}`;
  const visibleCategoryCount = useMemo(
    () => visibleNavCategories.length,
    [visibleNavCategories]
  );
  const navIndexes = useMemo(() => {
    const indexes: Record<string, number> = {};
    visibleStories.forEach((entry, index) => {
      indexes[entry.story.id] = index;
    });
    return indexes;
  }, [visibleStories]);
  const atomStoriesBySource = useMemo(() => {
    const entries = new Map<string, StoryEntry>();
    for (const entry of stories) {
      if (getSectionKind(entry.section) !== 'atom') continue;
      if (!entries.has(entry.story.source)) entries.set(entry.story.source, entry);
    }
    return entries;
  }, [stories]);
  const dataStoriesBySource = useMemo(() => {
    const entries = new Map<string, StoryEntry>();
    for (const entry of stories) {
      if (!isDataStory(entry.story)) continue;
      if (!entries.has(entry.story.source)) entries.set(entry.story.source, entry);
    }
    return entries;
  }, [stories]);
  const activeNavIndex = active.entry
    ? visibleStories.findIndex((entry) => entry.story.id === active.entry!.story.id)
    : -1;
  const activeThemeTokens = galleryTheme.active?.tokensByPath;
  const activeThemeAccent = getThemeStringToken(activeThemeTokens, 'accent.accentHot', COLORS.accent);
  const activeThemeSurface = getThemeStringToken(activeThemeTokens, 'surfaces.bg2', COLORS.panelBg);
  const activeThemeInk = getThemeStringToken(activeThemeTokens, 'ink.ink', COLORS.text);
  const hasActiveFilters = kindFilter !== 'all' || groupFilter !== 'all' || tagFilter !== 'all';
  const activeFilterCount = (kindFilter !== 'all' ? 1 : 0) + (groupFilter !== 'all' ? 1 : 0) + (tagFilter !== 'all' ? 1 : 0);
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (kindFilter !== 'all') parts.push(KIND_TITLES[kindFilter]);
    if (groupFilter !== 'all') {
      const selectedGroup = allGroupFilters.find((group) => group.id === groupFilter);
      if (selectedGroup) parts.push(selectedGroup.label);
    }
    if (tagFilter !== 'all') {
      const selectedTag = allTagFilters.find((tag) => tag.id === tagFilter);
      if (selectedTag) parts.push(selectedTag.label);
    }
    return parts.length > 0 ? parts.join(' · ') : 'Kind, group, and tag';
  }, [allGroupFilters, allTagFilters, groupFilter, kindFilter, tagFilter]);

  useEffect(() => {
    if (groupFilter === 'all') return;
    if (!groupFilters.some((group) => group.id === groupFilter)) {
      setGroupFilter('all');
    }
  }, [groupFilter, groupFilters]);

  useEffect(() => {
    if (tagFilter === 'all') return;
    if (!tagFilters.some((tag) => tag.id === tagFilter)) {
      setTagFilter('all');
    }
  }, [tagFilter, tagFilters]);

  const selectStory = (entry: StoryEntry, variantId?: string) => {
    nav.push(storyRoutePath(entry, variantId));
  };

  const navigateStories = (delta: number) => {
    if (visibleStories.length === 0) return;
    const current = activeNavIndex >= 0 ? activeNavIndex : delta > 0 ? -1 : 0;
    const nextIndex = (current + delta + visibleStories.length) % visibleStories.length;
    selectStory(visibleStories[nextIndex]);
  };

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  const clearFilters = () => {
    setKindFilter('all');
    setGroupFilter('all');
    setTagFilter('all');
  };

  const cycleGalleryTheme = (delta: number) => {
    if (galleryTheme.options.length === 0) {
      console.log('[gallery-theme:shell] cycle ignored: no theme options');
      return;
    }
    const currentIndex = activeGalleryThemeIndex >= 0 ? activeGalleryThemeIndex : 0;
    const nextIndex = (currentIndex + delta + galleryTheme.options.length) % galleryTheme.options.length;
    const currentOption = galleryTheme.options[currentIndex];
    const nextOption = galleryTheme.options[nextIndex];
    console.log('[gallery-theme:shell] cycle', {
      delta,
      currentIndex,
      nextIndex,
      current: currentOption?.id,
      next: nextOption?.id,
      activeThemeId: galleryTheme.activeThemeId,
      optionCount: galleryTheme.options.length,
    });
    if (nextOption) galleryTheme.setTheme(nextOption.id);
  };

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: COLORS.appBg }}>
      <Col style={{ width: '100%', height: '100%' }}>
        <Row
          style={{
            height: 76,
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingLeft: 24,
            paddingRight: 24,
            backgroundColor: COLORS.railBg,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.border,
          }}
        >
          <Col style={{ gap: 4 }}>
            <Text style={{ fontSize: 19, fontWeight: 'bold', color: COLORS.text }}>Component Gallery</Text>
            <Text style={{ fontSize: 11, color: COLORS.muted }}>cart/app/gallery</Text>
          </Col>
          <Row style={{ gap: 10, alignItems: 'center' }}>
            {galleryTheme.options.length > 0 ? (
              <GalleryThemeToggle
                label="Runtime Theme"
                activeLabel={galleryTheme.active?.label || 'Unassigned'}
                disabled={galleryTheme.options.length <= 1}
                swatchBackground={activeThemeSurface}
                swatchBorder={activeThemeInk}
                swatchColor={activeThemeAccent}
                onCycle={() => cycleGalleryTheme(1)}
              />
            ) : null}
            <Metric label="stories" value={String(stories.length)} tone={COLORS.accent} />
            <Metric label="top-level" value={String(topLevelCount)} tone={COLORS.compose} />
            <Metric label="variants" value={String(variantCount)} tone={COLORS.success} />
          </Row>
        </Row>

        <Row style={{ flexGrow: 1, flexBasis: 0 }}>
          <Col
            style={{
              width: 320,
              height: '100%',
              padding: 12,
              gap: 8,
              backgroundColor: COLORS.railBg,
              borderRightWidth: 1,
              borderRightColor: COLORS.border,
            }}
          >
            <Row style={{ alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Col style={{ gap: 2 }}>
                <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLORS.faint }}>NAVIGATION</Text>
                <Text style={{ fontSize: 9, color: COLORS.muted }}>
                  {`${visibleStories.length} of ${stories.length} stories in ${visibleCategoryCount} categories`}
                </Text>
              </Col>
              <Row style={{ width: 130, gap: 6 }}>
                <NavActionButton
                  label="Prev"
                  disabled={visibleStories.length === 0}
                  onPress={() => navigateStories(-1)}
                />
                <NavActionButton
                  label="Next"
                  disabled={visibleStories.length === 0}
                  onPress={() => navigateStories(1)}
                />
              </Row>
            </Row>

            <Row
              style={{
                width: '100%',
                height: 32,
                alignItems: 'center',
                gap: 8,
                paddingLeft: 10,
                paddingRight: 8,
                borderRadius: 8,
                backgroundColor: COLORS.panelBg,
                borderWidth: 1,
                borderColor: COLORS.border,
              }}
            >
              <Text style={{ width: 28, fontSize: 10, fontWeight: 'bold', color: COLORS.faint }}>Find</Text>
              <TextInput
                value={navQuery}
                onChangeText={updateNavQuery}
                placeholder="Search title, tag, group, file, atom, or data key"
                fontSize={12}
                color={COLORS.text}
                style={{
                  height: 22,
                  flexGrow: 1,
                  flexBasis: 0,
                  minWidth: 0,
                  paddingLeft: 0,
                  paddingRight: 0,
                  backgroundColor: COLORS.panelBg,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: COLORS.text,
                }}
              />
              {navQuery.length > 0 && (
                <Pressable
                  onPress={() => setNavQuery('')}
                  style={{
                    width: 46,
                    height: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 6,
                    backgroundColor: COLORS.railBg,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                  }}
                >
                  <Text style={{ fontSize: 9, fontWeight: 'bold', color: COLORS.muted }}>Clear</Text>
                </Pressable>
              )}
            </Row>

            {trimmedNavQuery ? (
              <Text style={{ fontSize: 9, color: COLORS.muted }}>
                {`${visibleStories.length} ${visibleStories.length === 1 ? 'match' : 'matches'} for "${trimmedNavQuery}"`}
              </Text>
            ) : null}

            <Col
              style={{
                width: '100%',
                padding: 10,
                gap: filtersExpanded ? 8 : 6,
                borderRadius: 8,
                backgroundColor: COLORS.panelBg,
                borderWidth: 1,
                borderColor: COLORS.border,
              }}
            >
              <Row style={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Col style={{ gap: 2, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
                  <Text style={{ fontSize: 10, fontWeight: 'bold', color: COLORS.faint }}>FILTERS</Text>
                  <Text style={{ fontSize: 8, color: hasActiveFilters ? COLORS.accent : COLORS.muted }}>
                    {filterSummary}
                  </Text>
                </Col>
                <Row style={{ alignItems: 'center', gap: 6 }}>
                  {hasActiveFilters && (
                    <Pressable
                      onPress={clearFilters}
                      style={{
                        height: 22,
                        paddingLeft: 8,
                        paddingRight: 8,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: CHIP_RADIUS,
                        backgroundColor: COLORS.railBg,
                        borderWidth: 1,
                        borderColor: COLORS.border,
                      }}
                    >
                      <Text style={{ fontSize: 8, fontWeight: 'bold', color: COLORS.muted }}>
                        {activeFilterCount > 1 ? `Clear ${activeFilterCount}` : 'Clear'}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => setFiltersExpanded((current) => !current)}
                    style={{
                      height: 22,
                      paddingLeft: 8,
                      paddingRight: 8,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: CHIP_RADIUS,
                      backgroundColor: COLORS.railBg,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                    }}
                  >
                    <Text style={{ fontSize: 8, fontWeight: 'bold', color: COLORS.text }}>
                      {filtersExpanded ? 'Hide' : 'Show'}
                    </Text>
                  </Pressable>
                </Row>
              </Row>

              {filtersExpanded && (
                <Col style={{ width: '100%', gap: 8 }}>
                  <FilterSection label="Kind">
                    <FilterChip label="All" active={kindFilter === 'all'} onPress={() => setKindFilter('all')} />
                    {kindFilterOptions.map((option) => (
                      <FilterChip
                        key={option.id}
                        label={option.label}
                        active={kindFilter === option.id}
                        onPress={() => setKindFilter(option.id)}
                      />
                    ))}
                  </FilterSection>

                  <FilterSection label="Group">
                    <FilterChip label="All" active={groupFilter === 'all'} onPress={() => setGroupFilter('all')} />
                    {groupFilters.map((group) => (
                      <FilterChip
                        key={group.id}
                        label={group.label}
                        active={groupFilter === group.id}
                        onPress={() => setGroupFilter(group.id)}
                      />
                    ))}
                  </FilterSection>

                  {tagFilters.length > 0 && (
                    <FilterSection label="Tag">
                      <FilterChip label="All" active={tagFilter === 'all'} onPress={() => setTagFilter('all')} />
                      {tagFilters.map((tag) => (
                        <FilterChip
                          key={tag.id}
                          label={tag.label}
                          active={tagFilter === tag.id}
                          onPress={() => setTagFilter(tag.id)}
                        />
                      ))}
                    </FilterSection>
                  )}
                </Col>
              )}
            </Col>

            {stories.length === 0 ? (
              <Box
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: COLORS.panelBg,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                }}
              >
                <Text style={{ fontSize: 12, color: COLORS.muted }}>No stories yet</Text>
              </Box>
            ) : visibleStories.length === 0 ? (
              <Box
                style={{
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: COLORS.panelBg,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: 'bold', color: COLORS.text }}>No matches</Text>
                <Text style={{ fontSize: 10, color: COLORS.muted }}>{navQuery}</Text>
              </Box>
            ) : (
              <ScrollView
                key={navListKey}
                showScrollbar
                style={{ width: '100%', flexGrow: 1, flexBasis: 0, minHeight: 0 }}
              >
                <Col style={{ width: '100%', gap: 8 }}>
                  {visibleNavCategories.map((category) => {
                    const groupKey = `category:${category.id}`;
                    const hasActiveStory = category.entries.some(
                      (entry) => entry.story.id === active.entry?.story.id
                    );
                    const collapsed = navQuery.length === 0 && !hasActiveStory && !!collapsedGroups[groupKey];

                    return (
                      <Col key={category.id} style={{ width: '100%', gap: 3 }}>
                        <StoryNavGroupHeader
                          title={category.title}
                          count={category.entries.length}
                          collapsed={collapsed}
                          onPress={() => toggleGroup(groupKey)}
                        />
                        {!collapsed && (
                          <Col style={{ width: '100%', gap: 3, paddingLeft: 10 }}>
                            {category.entries.map((entry) => (
                              <StoryNavItem
                                key={entry.story.id}
                                entry={entry}
                                active={active.entry?.story.id === entry.story.id}
                                index={navIndexes[entry.story.id] ?? 0}
                                onPress={() => selectStory(entry)}
                              />
                            ))}
                          </Col>
                        )}
                      </Col>
                    );
                  })}
                </Col>
              </ScrollView>
            )}
          </Col>

          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
            <Col
              style={{
                minHeight: 74,
                justifyContent: 'center',
                paddingLeft: 18,
                paddingRight: 18,
                paddingTop: 8,
                paddingBottom: 8,
                backgroundColor: COLORS.panelBg,
                borderBottomWidth: 1,
                borderBottomColor: COLORS.border,
              }}
            >
              <Col style={{ gap: 3, width: '100%' }}>
                <Text style={{ fontSize: 14, fontWeight: 'bold', color: COLORS.text }}>
                  {active.entry ? active.entry.story.title : PAGE_SURFACE.label}
                </Text>
                <Text style={{ fontSize: 10, color: COLORS.muted }}>
                  {active.entry ? active.entry.story.source : 'cart/app/gallery'}
                </Text>
                {active.entry && (
                  <Row
                    style={{
                      width: '100%',
                      gap: 8,
                      marginTop: 6,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <MetaBadge
                      label={getStoryTypeLabel(active.entry)}
                      tone={
                        isThemeStory(active.entry.story)
                          ? COLORS.accent
                          : isDataStory(active.entry.story)
                          ? COLORS.success
                          : getSectionKind(active.entry.section) === 'top-level'
                            ? COLORS.warning
                            : COLORS.text
                      }
                      background={
                        isThemeStory(active.entry.story)
                          ? COLORS.railBg
                          : isDataStory(active.entry.story)
                          ? COLORS.railBg
                          : getSectionKind(active.entry.section) === 'top-level'
                          ? COLORS.panelRaised
                          : COLORS.railBg
                      }
                    />
                    <MetaBadge
                      label={getSectionGroup(active.entry.section).title}
                      tone={COLORS.accent}
                      background={COLORS.railBg}
                    />
                    {getDataStoryStorage(active.entry.story).map((storage) => (
                      <MetaBadge
                        key={storage}
                        label={formatStorageLabel(storage)}
                        tone={COLORS.success}
                        background={COLORS.railBg}
                      />
                    ))}
                    {getStoryTags(active.entry.section, active.entry.story).map((tag) => (
                        <MetaBadge
                          key={tag}
                          label={formatCanonicalTagLabel(tag)}
                          tone={getTagTone(tag)}
                          background={COLORS.railBg}
                        />
                      ))}
                    {getSectionKind(active.entry.section) === 'top-level' && (
                      <Text style={{ fontSize: 10, color: COLORS.muted }}>
                        {`${getComposedOf(active.entry.section).length} atom references`}
                      </Text>
                    )}
                    {isDataStory(active.entry.story) && getDataStoryReferences(active.entry.story).length > 0 && (
                      <Text style={{ fontSize: 10, color: COLORS.muted }}>
                        {`${getDataStoryReferences(active.entry.story).length} linked shapes`}
                      </Text>
                    )}
                    {isThemeStory(active.entry.story) && (
                      <Text style={{ fontSize: 10, color: COLORS.muted }}>
                        {`${getThemeStoryVariants(active.entry.story).length} theme variants · ${countThemeTokens(active.entry.story.globalTokens)} global tokens`}
                      </Text>
                    )}
                  </Row>
                )}
              </Col>

              {active.entry && (
                <CompositionPanel
                  key={active.entry.story.id}
                  entry={active.entry}
                  atomStoriesBySource={atomStoriesBySource}
                  onSelectAtom={selectStory}
                />
              )}

              {active.entry && getStoryVariants(active.entry.story).length > 1 && (
                <Row style={{ width: '100%', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {getStoryVariants(active.entry.story).map((variant) => (
                    <VariantButton
                      key={variant.id}
                      variant={variant}
                      active={active.variant?.id === variant.id}
                      onPress={() => selectStory(active.entry!, variant.id)}
                    />
                  ))}
                </Row>
              )}
            </Col>

            <ScrollView
              style={{
                flexGrow: 1,
                flexBasis: 0,
                backgroundColor: COLORS.previewBg,
              }}
              showScrollbar
            >
              <Box
                style={{
                  width: '100%',
                  minHeight: 760,
                  alignItems: 'center',
                  padding: 28,
                }}
              >
                <Box
                  style={{
                    width: PAGE_SURFACE.width,
                    minHeight: PAGE_SURFACE.minHeight,
                    padding: PAGE_SURFACE.padding,
                    borderRadius: PAGE_SURFACE.radius,
                    backgroundColor: PAGE_SURFACE.backgroundColor,
                    borderWidth: 1,
                    borderColor: PAGE_SURFACE.borderColor,
                  }}
                >
                  {active.entry ? (
                    isDataStory(active.entry.story) ? (
                      <DataStoryPreview
                        story={active.entry.story}
                        dataStoriesBySource={dataStoriesBySource}
                        onSelectReference={selectStory}
                      />
                    ) : isThemeStory(active.entry.story) ? (
                      <ThemeStoryPreview
                        story={active.entry.story}
                        activeThemeId={galleryTheme.activeThemeId}
                        onApplyTheme={galleryTheme.setTheme}
                      />
                    ) : (
                      <StoryStage>{active.variant ? active.variant.render() : <EmptyPreview />}</StoryStage>
                    )
                  ) : (
                    <StoryStage>
                      <EmptyPreview />
                    </StoryStage>
                  )}
                </Box>
              </Box>
            </ScrollView>
          </Col>
        </Row>
      </Col>
    </Box>
  );
}

function ComponentGalleryRoutes() {
  return (
    <>
      <Route path="/stories/:storyId/:variantId">
        {(params: any) => (
          <ActiveComponentGalleryShell selection={routeSelection(params.storyId, params.variantId)} />
        )}
      </Route>
      <Route path="/stories/:storyId">
        {(params: any) => (
          <ActiveComponentGalleryShell selection={routeSelection(params.storyId, ROUTE_DEFAULT_VARIANT)} />
        )}
      </Route>
      <Route path="/data">
        <ActiveComponentGalleryShell selection={null} />
      </Route>
      <Route path="/atoms">
        <ActiveComponentGalleryShell selection={null} />
      </Route>
      <Route path="/components">
        <ActiveComponentGalleryShell selection={null} />
      </Route>
      <Route path="/tokens">
        <ActiveComponentGalleryShell selection={null} />
      </Route>
      <Route path="/audit">
        <AuditPage />
      </Route>
      <Route path="/">
        <ActiveComponentGalleryShell selection={null} />
      </Route>
      <Route fallback>
        <ActiveComponentGalleryShell selection={null} />
      </Route>
    </>
  );
}

export default function ComponentGalleryApp() {
  return (
    <TooltipRoot>
      <Router initialPath={initialGalleryRoutePath()} hotKey={GALLERY_ROUTER_HOT_KEY}>
        <ComponentGalleryRoutes />
      </Router>
    </TooltipRoot>
  );
}
