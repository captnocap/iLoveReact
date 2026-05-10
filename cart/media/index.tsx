import React from 'react';
import { Route, Router, useNavigate, useRoute } from '../../runtime/router';
import { ThemeProvider } from '../../runtime/theme';
import { Box, Image, Pressable, Video } from '../../runtime/primitives';
import { useMedia } from '../../runtime/hooks';
import { useFileWatch } from '../../runtime/hooks/useFileWatch';
import { VideoPlayer } from './video';

function formatVideoTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
import { fs } from '../../runtime/hooks';
import type { MediaFile } from '../../runtime/hooks/media';
import './style_cls';
import { C } from './style_cls';
import { APP_COLORS, APP_STYLES } from './theme';
import {
  getDb, upsertMedia, listMedia, getMediaByPath, toggleFavorite, toggleOrganized,
  setRating, setDescription, setTitle, listTags, getTagsForMedia,
  ensureTag, addTagToMedia, removeTagFromMedia, listPerformers, ensurePerformer,
  getPerformersForMedia, addPerformerToMedia, removePerformerFromMedia,
  listStudios, ensureStudio, getStudiosForMedia, addStudioToMedia, removeStudioFromMedia,
  listGalleries, createGallery, addToGallery, getGalleryMedia, listComments,
  addComment, deleteComment, listScanDirs, addScanDir, removeScanDir,
  getSetting, setSetting, ensureThumbnail, extractDuration,
  type MediaItem, type MediaType, type Tag, type Performer, type Studio, type Gallery, type Comment,
} from './db';

type FilterKind = 'all' | 'image' | 'video' | 'audio' | 'favorite';
type ViewMode = 'grid' | 'list';

function formatSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString();
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Shared DB ref ───────────────────────────────────────────
const dbRef = { current: getDb() };

function syncScannedFiles(files: MediaFile[]) {
  const db = dbRef.current;
  for (const f of files) {
    const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
    upsertMedia(db, {
      path: f.path,
      parent_path: parent,
      name: f.name,
      type: f.type as MediaType,
      size: f.size,
      mtime: f.mtime ?? undefined,
      favorite: false,
      organized: false,
      rating: 0,
      notes: '',
      description: '',
      title: '',
    });
  }
}

const thumbPending = new Set<string>();
async function queueThumbnail(path: string, type: MediaType) {
  if (thumbPending.has(path)) return;
  thumbPending.add(path);
  const thumb = await ensureThumbnail(path, type);
  if (thumb) {
    dbRef.current.exec(`UPDATE media_items SET thumbnail_path = ? WHERE path = ?`, [thumb, path]);
  }
  thumbPending.delete(path);
}

// ═════════════════════════════════════════════════════════════
//  BROWSE VIEW
// ═════════════════════════════════════════════════════════════

function BrowseView() {
  const nav = useNavigate();
  const mediaRef = React.useRef(useMedia());
  const [tick, setTick] = React.useState(0);
  const bump = () => setTick((t) => t + 1);
  const db = dbRef.current;

  const [viewMode, setViewMode] = React.useState<ViewMode>((getSetting(db, 'viewMode', 'grid') as ViewMode));
  const [search, setSearch] = React.useState('');
  const [sortBy, setSortBy] = React.useState(getSetting(db, 'sortBy', 'mtime'));
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>((getSetting(db, 'sortOrder', 'desc') as 'asc' | 'desc'));
  const [filterType, setFilterType] = React.useState<FilterKind>('all');
  const [minRating, setMinRating] = React.useState(0);
  const [showFilters, setShowFilters] = React.useState(false);
  const [items, setItems] = React.useState<MediaItem[]>([]);
  const [allTags, setAllTags] = React.useState<Tag[]>([]);
  const [allPerformers, setAllPerformers] = React.useState<Performer[]>([]);
  const [allStudios, setAllStudios] = React.useState<Studio[]>([]);
  const [galleries, setGalleries] = React.useState<Gallery[]>([]);
  const [scanning, setScanning] = React.useState(false);

  const [selectedTagIds, setSelectedTagIds] = React.useState<number[]>([]);
  const [selectedPerformerIds, setSelectedPerformerIds] = React.useState<number[]>([]);
  const [selectedStudioIds, setSelectedStudioIds] = React.useState<number[]>([]);

  // Initial scan + auto-rescan on file changes
  const scanTimeoutRef = React.useRef<any>(null);
  const doScan = React.useCallback(async () => {
    setScanning(true);
    const dirs = listScanDirs(db);
    if (dirs.length === 0) {
      addScanDir(db, '.', false);
      dirs.push({ id: 1, path: '.', recursive: false, created_at: 0 });
    }
    for (const d of dirs) {
      const files = await mediaRef.current.scan({ dir: d.path, kinds: ['image', 'video', 'audio'], recursive: d.recursive });
      syncScannedFiles(files);
    }
    // Extract missing durations in background
    const missing = db.query<{ id: number; path: string; type: MediaType }>(
      `SELECT id, path, type FROM media_items WHERE type IN ('video','audio') AND (duration IS NULL OR duration = 0)`
    );
    for (const m of missing) {
      const dur = await extractDuration(m.path, m.type);
      if (dur) db.exec(`UPDATE media_items SET duration = ? WHERE id = ?`, [dur, m.id]);
    }
    setScanning(false);
    bump();
  }, [db]);

  React.useEffect(() => { doScan(); }, []);

  useFileWatch('.', (ev) => {
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => doScan(), 1200);
  }, { recursive: true, intervalMs: 1500 });

  // Query DB on filter change
  React.useEffect(() => {
    const types = filterType === 'all' || filterType === 'favorite'
      ? ['image', 'video', 'audio']
      : [filterType];
    const rows = listMedia(db, {
      types: types as MediaType[],
      favorite: filterType === 'favorite' ? true : undefined,
      minRating: minRating > 0 ? minRating : undefined,
      text: search,
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      performerIds: selectedPerformerIds.length > 0 ? selectedPerformerIds : undefined,
      studioIds: selectedStudioIds.length > 0 ? selectedStudioIds : undefined,
      orderBy: sortBy as any,
      order: sortOrder,
    });
    setItems(rows);
    setAllTags(listTags(db));
    setAllPerformers(listPerformers(db));
    setAllStudios(listStudios(db));
    setGalleries(listGalleries(db));
  }, [tick, search, sortBy, sortOrder, filterType, minRating, selectedTagIds, selectedPerformerIds, selectedStudioIds]);

  const savePref = (k: string, v: string) => setSetting(db, k, v);
  const hasActiveFilters = selectedTagIds.length + selectedPerformerIds.length + selectedStudioIds.length + minRating > 0 || filterType !== 'all';

  const clearFilters = () => {
    setFilterType('all');
    setMinRating(0);
    setSelectedTagIds([]);
    setSelectedPerformerIds([]);
    setSelectedStudioIds([]);
    setSearch('');
  };

  const typeLabel = (k: FilterKind) => ({ all: 'All', image: 'Images', video: 'Videos', audio: 'Audio', favorite: 'Favorites' })[k];

  return (
    <C.AppBody>
      {/* Toolbar */}
      <C.AppRow style={{ alignItems: 'center', gap: 'theme:spacingSm' }}>
        <C.AppTextInput value={search} onChange={setSearch} placeholder="Search media…" style={{ flexGrow: 1 }} />
        <C.AppNavItem onPress={() => setShowFilters((s) => !s)} style={{ backgroundColor: showFilters ? 'theme:primary' : undefined }}>
          <C.AppNavText style={{ color: showFilters ? 'theme:bg' : undefined }}>Filters</C.AppNavText>
        </C.AppNavItem>
        <C.AppNavItem onPress={() => { const n = viewMode === 'grid' ? 'list' : 'grid'; setViewMode(n); savePref('viewMode', n); }}>
          <C.AppNavText>{viewMode === 'grid' ? '☰ List' : '⊞ Grid'}</C.AppNavText>
        </C.AppNavItem>
        <C.AppNavItem onPress={doScan}><C.AppNavText>{scanning ? '…' : '↻ Scan'}</C.AppNavText></C.AppNavItem>
      </C.AppRow>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <C.AppRow style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {filterType !== 'all' && (
            <FilterChip label={typeLabel(filterType)!} onRemove={() => setFilterType('all')} />
          )}
          {minRating > 0 && (
            <FilterChip label={`${'★'.repeat(minRating)}+`} onRemove={() => setMinRating(0)} />
          )}
          {selectedTagIds.map((id) => {
            const t = allTags.find((x) => x.id === id);
            return t ? <FilterChip key={id} label={t.name} color={t.color} onRemove={() => setSelectedTagIds((s) => s.filter((x) => x !== id))} /> : null;
          })}
          {selectedPerformerIds.map((id) => {
            const p = allPerformers.find((x) => x.id === id);
            return p ? <FilterChip key={id} label={p.name} onRemove={() => setSelectedPerformerIds((s) => s.filter((x) => x !== id))} /> : null;
          })}
          {selectedStudioIds.map((id) => {
            const s = allStudios.find((x) => x.id === id);
            return s ? <FilterChip key={id} label={s.name} onRemove={() => setSelectedStudioIds((s) => s.filter((x) => x !== id))} /> : null;
          })}
          <Pressable onPress={clearFilters}><C.AppDim>Clear all</C.AppDim></Pressable>
        </C.AppRow>
      )}

      {/* Filter panel */}
      {showFilters && (
        <C.AppPanel style={{ flexGrow: 0, flexBasis: 'auto' }}>
          <FilterSection title="Type">
            {(['all', 'image', 'video', 'audio', 'favorite'] as FilterKind[]).map((k) => (
              <C.FilterPill key={k} onPress={() => setFilterType(k)} style={{
                backgroundColor: filterType === k ? 'theme:primary' : 'theme:surface',
                borderColor: filterType === k ? 'theme:primary' : 'theme:border',
              }}>
                <C.FilterPillText style={{ color: filterType === k ? 'theme:bg' : 'theme:textSecondary' }}>{typeLabel(k)}</C.FilterPillText>
              </C.FilterPill>
            ))}
          </FilterSection>

          <FilterSection title="Sort">
            {(['name', 'mtime', 'rating', 'size', 'random'] as string[]).map((k) => (
              <C.FilterPill key={k} onPress={() => { setSortBy(k); savePref('sortBy', k); }} style={{
                backgroundColor: sortBy === k ? 'theme:primary' : 'theme:surface',
                borderColor: sortBy === k ? 'theme:primary' : 'theme:border',
              }}>
                <C.FilterPillText style={{ color: sortBy === k ? 'theme:bg' : 'theme:textSecondary' }}>
                  {k === 'mtime' ? 'Date' : k[0].toUpperCase() + k.slice(1)}
                </C.FilterPillText>
              </C.FilterPill>
            ))}
            <C.AppNavItem onPress={() => { const o = sortOrder === 'asc' ? 'desc' : 'asc'; setSortOrder(o); savePref('sortOrder', o); }}>
              <C.AppNavText>{sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}</C.AppNavText>
            </C.AppNavItem>
          </FilterSection>

          <FilterSection title="Min Rating">
            {[0, 1, 2, 3, 4, 5].map((r) => (
              <C.FilterPill key={r} onPress={() => setMinRating(r)} style={{
                backgroundColor: minRating === r ? 'theme:primary' : 'theme:surface',
                borderColor: minRating === r ? 'theme:primary' : 'theme:border',
              }}>
                <C.FilterPillText style={{ color: minRating === r ? 'theme:bg' : 'theme:textSecondary' }}>
                  {r === 0 ? 'Any' : '★'.repeat(r)}
                </C.FilterPillText>
              </C.FilterPill>
            ))}
          </FilterSection>

          {allTags.length > 0 && (
            <FilterSection title="Tags">
              {allTags.map((t) => (
                <PillToggle key={t.id} label={t.name} active={selectedTagIds.includes(t.id)} color={t.color} onPress={() => toggleId(t.id, selectedTagIds, setSelectedTagIds)} />
              ))}
            </FilterSection>
          )}

          {allPerformers.length > 0 && (
            <FilterSection title="Performers">
              {allPerformers.map((p) => (
                <PillToggle key={p.id} label={p.name} active={selectedPerformerIds.includes(p.id)} onPress={() => toggleId(p.id, selectedPerformerIds, setSelectedPerformerIds)} />
              ))}
            </FilterSection>
          )}

          {allStudios.length > 0 && (
            <FilterSection title="Studios">
              {allStudios.map((s) => (
                <PillToggle key={s.id} label={s.name} active={selectedStudioIds.includes(s.id)} onPress={() => toggleId(s.id, selectedStudioIds, setSelectedStudioIds)} />
              ))}
            </FilterSection>
          )}
        </C.AppPanel>
      )}

      {/* Results */}
      {scanning && items.length === 0 ? (
        <C.EmptyState><C.AppSubtle>Scanning your library…</C.AppSubtle></C.EmptyState>
      ) : items.length === 0 ? (
        <C.EmptyState>
          <C.EmptyStateText>No media found</C.EmptyStateText>
          <C.AppDim>Try clearing filters or adding a scan directory in Settings.</C.AppDim>
        </C.EmptyState>
      ) : (
        <>
          <C.AppDim>{items.length} item{items.length !== 1 ? 's' : ''}</C.AppDim>
          {viewMode === 'grid' ? (
            <C.GalleryScrollView>
              <C.GalleryGrid>
                {items.map((item) => (
                  <GridCard key={item.id} item={item} />
                ))}
              </C.GalleryGrid>
            </C.GalleryScrollView>
          ) : (
            <C.GalleryScrollView>
              {items.map((item) => (
                <ListRow key={item.id} item={item} onPress={() => nav.push(`/view/${encodeURIComponent(item.path)}`)} />
              ))}
            </C.GalleryScrollView>
          )}
        </>
      )}
    </C.AppBody>
  );
}

function FilterChip({ label, color, onRemove }: { label: string; color?: string; onRemove: () => void }) {
  return (
    <C.ActiveFilterChip onPress={onRemove} style={{ backgroundColor: color || 'theme:primary' }}>
      <C.ActiveFilterChipText>{label} ×</C.ActiveFilterChipText>
    </C.ActiveFilterChip>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <C.AppRow style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center', paddingTop: 6, paddingBottom: 6 }}>
      <C.AppDim style={{ minWidth: 80 }}>{title}</C.AppDim>
      {children}
    </C.AppRow>
  );
}

function PillToggle({ label, active, color, onPress }: { label: string; active: boolean; color?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <C.AppBadge style={{ backgroundColor: active ? (color || 'theme:primary') : 'theme:bgElevated' }}>
        <C.AppBadgeText style={{ color: active ? '#0b1117' : 'theme:accent' }}>{label}</C.AppBadgeText>
      </C.AppBadge>
    </Pressable>
  );
}

function toggleId(id: number, arr: number[], setArr: (v: number[]) => void) {
  setArr(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
}

function GridCard({ item }: { item: MediaItem }) {
  const nav = useNavigate();
  const isVideo = item.type === 'video';
  const src = item.thumbnail_path || item.path;

  React.useEffect(() => { if (!item.thumbnail_path) queueThumbnail(item.path, item.type); }, [item.path, item.thumbnail_path]);

  return (
    <C.GalleryCard onPress={() => nav.push(`/view/${encodeURIComponent(item.path)}`)}>
      <C.GalleryThumbnail>
        {isVideo ? (
          <Video src={src} style={{ width: '100%', height: '100%' }} paused={true} />
        ) : (
          <Image source={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        <C.GalleryTypeBadge style={{ backgroundColor: isVideo ? 'rgba(200,50,50,0.85)' : 'rgba(50,120,200,0.85)' }}>
          <C.GalleryTypeText>{isVideo ? '▶ VIDEO' : '🖼 IMAGE'}</C.GalleryTypeText>
        </C.GalleryTypeBadge>
        {item.favorite && (
          <C.GalleryFavBadge><C.GalleryTypeText>★</C.GalleryTypeText></C.GalleryFavBadge>
        )}
        {item.rating > 0 && (
          <C.GalleryRatingBadge><C.GalleryTypeText>{'★'.repeat(item.rating)}</C.GalleryTypeText></C.GalleryRatingBadge>
        )}
      </C.GalleryThumbnail>
      <C.GalleryCardFooter>
        <C.GalleryCardTitle>{item.title || item.name}</C.GalleryCardTitle>
        <C.AppDim>{formatSize(item.size)}</C.AppDim>
      </C.GalleryCardFooter>
    </C.GalleryCard>
  );
}

function ListRow({ item, onPress }: { item: MediaItem; onPress: () => void }) {
  const isVideo = item.type === 'video';
  const src = item.thumbnail_path || item.path;
  React.useEffect(() => { if (!item.thumbnail_path) queueThumbnail(item.path, item.type); }, [item.path, item.thumbnail_path]);

  return (
    <C.ListRow onPress={onPress}>
      <C.ListRowThumb>
        {isVideo ? (
          <Video src={src} style={{ width: '100%', height: '100%' }} paused={true} />
        ) : (
          <Image source={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </C.ListRowThumb>
      <C.ListRowMeta>
        <C.ListRowTitle>{item.title || item.name}</C.ListRowTitle>
        <C.ListRowSub>{isVideo ? 'Video' : 'Image'} · {formatSize(item.size)} · {formatDate(item.mtime)}</C.ListRowSub>
      </C.ListRowMeta>
      <C.AppRow style={{ gap: 6, alignItems: 'center' }}>
        {item.rating > 0 && <C.AppDim style={{ color: 'theme:accent' }}>{'★'.repeat(item.rating)}</C.AppDim>}
        {item.favorite && <C.AppDim style={{ color: 'theme:accent' }}>★</C.AppDim>}
      </C.AppRow>
    </C.ListRow>
  );
}

// ═════════════════════════════════════════════════════════════
//  DETAIL VIEW
// ═════════════════════════════════════════════════════════════



function DetailView({ path }: { path: string }) {
  const nav = useNavigate();
  const db = dbRef.current;
  const [version, setVersion] = React.useState(0);
  const bump = () => setVersion((v) => v + 1);

  const media = React.useMemo(() => getMediaByPath(db, path), [path, version]);

  const [tags, setTags] = React.useState<Tag[]>([]);
  const [performers, setPerformers] = React.useState<Performer[]>([]);
  const [studios, setStudios] = React.useState<Studio[]>([]);
  const [comments, setComments] = React.useState<Comment[]>([]);
  const [inGalleries, setInGalleries] = React.useState<Gallery[]>([]);
  const [allGalleries, setAllGalleries] = React.useState<Gallery[]>([]);

  React.useEffect(() => {
    if (!media) return;
    setTags(getTagsForMedia(db, media.id));
    setPerformers(getPerformersForMedia(db, media.id));
    setStudios(getStudiosForMedia(db, media.id));
    setComments(listComments(db, media.id));
    setAllGalleries(listGalleries(db));
    const all = listGalleries(db);
    const containing = all.filter((g) => getGalleryMedia(db, g.id).some((m) => m.id === media.id));
    setInGalleries(containing);
  }, [media, version]);

  const [tagDraft, setTagDraft] = React.useState('');
  const [performerDraft, setPerformerDraft] = React.useState('');
  const [studioDraft, setStudioDraft] = React.useState('');
  const [commentDraft, setCommentDraft] = React.useState('');
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [editingDesc, setEditingDesc] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState('');
  const [descDraft, setDescDraft] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<'info' | 'people' | 'comments'>('info');

  if (!media) {
    return (
      <C.AppBody>
        <C.AppPanel>
          <C.AppPanelTitle>Media not found</C.AppPanelTitle>
          <C.AppSubtle>The file may have been moved or deleted.</C.AppSubtle>
          <C.AppNavItem onPress={() => nav.back()}><C.AppNavText>← Go back</C.AppNavText></C.AppNavItem>
        </C.AppPanel>
      </C.AppBody>
    );
  }

  const isVideo = media.type === 'video';
  const allItems = db.query<{ path: string }>(`SELECT path FROM media_items ORDER BY mtime DESC`);
  const currentIndex = allItems.findIndex((r) => r.path === path);
  const prevPath = currentIndex > 0 ? allItems[currentIndex - 1].path : null;
  const nextPath = currentIndex < allItems.length - 1 ? allItems[currentIndex + 1].path : null;

  return (
    <C.AppBody>
      <C.AppPanel style={{ flexGrow: 1, flexBasis: 0, overflow: 'hidden', padding: 0 }}>
        {/* Header */}
        <C.GalleryDetailHeader>
          <C.AppNavItem onPress={() => nav.back()}><C.AppNavText>← Back</C.AppNavText></C.AppNavItem>
          <C.AppDim>{currentIndex + 1} / {allItems.length}</C.AppDim>
          <C.AppRow style={{ gap: 6 }}>
            <C.AppNavItem onPress={() => { toggleFavorite(db, media.id); bump(); }} style={{ backgroundColor: media.favorite ? 'theme:accent' : undefined }}>
              <C.AppNavText style={{ color: media.favorite ? '#0b1117' : undefined }}>{media.favorite ? '★ Fav' : '☆ Fav'}</C.AppNavText>
            </C.AppNavItem>
            <C.AppNavItem onPress={() => { toggleOrganized(db, media.id); bump(); }} style={{ backgroundColor: media.organized ? 'theme:success' : undefined }}>
              <C.AppNavText style={{ color: media.organized ? '#0b1117' : undefined }}>{media.organized ? '✓ Org' : 'Org'}</C.AppNavText>
            </C.AppNavItem>
          </C.AppRow>
        </C.GalleryDetailHeader>

        {/* Viewer */}
        <C.GalleryDetailImage>
          {isVideo ? (
            <VideoPlayer src={path} duration={media.duration} />
          ) : (
            <Image source={path} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          )}
        </C.GalleryDetailImage>

        {/* Quick info bar */}
        <C.AppRow style={{ justifyContent: 'space-between', padding: 'theme:spacingMd', borderTopWidth: 1, borderTopColor: 'theme:border', flexWrap: 'wrap' }}>
          <C.AppSubtle>{media.name}</C.AppSubtle>
          <C.AppDim>{formatSize(media.size)} · {isVideo ? 'Video' : 'Image'} · {formatDate(media.mtime)} {media.duration ? `· ${formatVideoTime(media.duration)}` : ''}</C.AppDim>
        </C.AppRow>

        {/* Tab bar */}
        <C.AppRow style={{ borderBottomWidth: 1, borderBottomColor: 'theme:border' }}>
          {(['info', 'people', 'comments'] as const).map((t) => (
            <Pressable key={t} onPress={() => setActiveTab(t)} style={{ flex: 1, alignItems: 'center', padding: 10, borderBottomWidth: 2, borderBottomColor: activeTab === t ? 'theme:primary' : 'transparent' }}>
              <C.AppNavText style={{ color: activeTab === t ? 'theme:primary' : 'theme:textSecondary' }}>
                {t === 'info' ? 'Info' : t === 'people' ? 'People' : `Comments (${comments.length})`}
              </C.AppNavText>
            </Pressable>
          ))}
        </C.AppRow>

        {/* Tab content */}
        <C.GalleryScrollView style={{ flexGrow: 1, flexBasis: 0, padding: 'theme:spacingMd' }}>
          {activeTab === 'info' && (
            <InfoTab media={media} db={db} bump={bump}
              editingTitle={editingTitle} setEditingTitle={setEditingTitle} titleDraft={titleDraft} setTitleDraft={setTitleDraft}
              editingDesc={editingDesc} setEditingDesc={setEditingDesc} descDraft={descDraft} setDescDraft={setDescDraft}
              inGalleries={inGalleries} allGalleries={allGalleries}
            />
          )}
          {activeTab === 'people' && (
            <PeopleTab media={media} db={db} bump={bump} tags={tags} performers={performers} studios={studios}
              tagDraft={tagDraft} setTagDraft={setTagDraft}
              performerDraft={performerDraft} setPerformerDraft={setPerformerDraft}
              studioDraft={studioDraft} setStudioDraft={setStudioDraft}
            />
          )}
          {activeTab === 'comments' && (
            <CommentsTab media={media} db={db} bump={bump} comments={comments} commentDraft={commentDraft} setCommentDraft={setCommentDraft} />
          )}

          {/* Prev / Next */}
          <C.AppRow style={{ justifyContent: 'space-between', paddingTop: 'theme:spacingLg' }}>
            <C.AppNavItem onPress={() => prevPath && nav.push(`/view/${encodeURIComponent(prevPath)}`)} style={{ opacity: prevPath ? 1 : 0.35 }}>
              <C.AppNavText>← Previous</C.AppNavText>
            </C.AppNavItem>
            <C.AppNavItem onPress={() => nextPath && nav.push(`/view/${encodeURIComponent(nextPath)}`)} style={{ opacity: nextPath ? 1 : 0.35 }}>
              <C.AppNavText>Next →</C.AppNavText>
            </C.AppNavItem>
          </C.AppRow>
        </C.GalleryScrollView>
      </C.AppPanel>
    </C.AppBody>
  );
}

function InfoTab({ media, db, bump, editingTitle, setEditingTitle, titleDraft, setTitleDraft, editingDesc, setEditingDesc, descDraft, setDescDraft, inGalleries, allGalleries }: any) {
  return (
    <C.AppCol>
      {/* Title */}
      <C.Section>
        {editingTitle ? (
          <C.InlineEditRow>
            <C.AppTextInput value={titleDraft} onChange={setTitleDraft} placeholder="Title…" style={{ flexGrow: 1 }} />
            <C.AppNavItem onPress={() => { setTitle(db, media.id, titleDraft); setEditingTitle(false); bump(); }}>Save</C.AppNavItem>
            <C.AppNavItem onPress={() => setEditingTitle(false)}>Cancel</C.AppNavItem>
          </C.InlineEditRow>
        ) : (
          <Pressable onPress={() => { setTitleDraft(media.title || ''); setEditingTitle(true); }}>
            <C.SectionTitle>{media.title || 'Untitled'}</C.SectionTitle>
            <C.AppDim>Tap to edit title</C.AppDim>
          </Pressable>
        )}
      </C.Section>

      {/* Rating */}
      <C.Section>
        <C.SectionHeader><C.SectionTitle>Rating</C.SectionTitle></C.SectionHeader>
        <C.AppRow style={{ gap: 6 }}>
          {[1, 2, 3, 4, 5].map((r) => (
            <Pressable key={r} onPress={() => { setRating(db, media.id, r === media.rating ? 0 : r); bump(); }}>
              <C.AppMetric style={{ fontSize: 22, color: r <= media.rating ? 'theme:accent' : 'theme:textDim' }}>★</C.AppMetric>
            </Pressable>
          ))}
        </C.AppRow>
      </C.Section>

      {/* Description */}
      <C.Section>
        <C.SectionHeader><C.SectionTitle>Description</C.SectionTitle></C.SectionHeader>
        {editingDesc ? (
          <C.AppCol>
            <C.AppTextInput value={descDraft} onChange={setDescDraft} placeholder="Description…" style={{ height: 80, textAlignVertical: 'top' }} />
            <C.AppRow style={{ justifyContent: 'flex-end' }}>
              <C.AppNavItem onPress={() => setEditingDesc(false)}>Cancel</C.AppNavItem>
              <C.AppNavItem onPress={() => { setDescription(db, media.id, descDraft); setEditingDesc(false); bump(); }}>Save</C.AppNavItem>
            </C.AppRow>
          </C.AppCol>
        ) : (
          <Pressable onPress={() => { setDescDraft(media.description || ''); setEditingDesc(true); }}>
            <C.AppSubtle>{media.description || 'No description. Tap to add one.'}</C.AppSubtle>
          </Pressable>
        )}
      </C.Section>

      {/* Galleries */}
      <C.Section>
        <C.SectionHeader><C.SectionTitle>Galleries</C.SectionTitle></C.SectionHeader>
        {inGalleries.length === 0 ? (
          <C.AppDim>Not in any gallery.</C.AppDim>
        ) : (
          <C.AppRow style={{ flexWrap: 'wrap', gap: 6 }}>
            {inGalleries.map((g: Gallery) => (
              <C.AppBadge key={g.id}><C.AppBadgeText>{g.name}</C.AppBadgeText></C.AppBadge>
            ))}
          </C.AppRow>
        )}
        <C.AppRow style={{ flexWrap: 'wrap', gap: 6, paddingTop: 8 }}>
          {allGalleries.filter((g: Gallery) => !inGalleries.some((ig: Gallery) => ig.id === g.id)).map((g: Gallery) => (
            <C.AppNavItem key={g.id} onPress={() => { addToGallery(db, g.id, media.id); bump(); }}>
              <C.AppNavText>+ {g.name}</C.AppNavText>
            </C.AppNavItem>
          ))}
        </C.AppRow>
      </C.Section>
    </C.AppCol>
  );
}

function PeopleTab({ media, db, bump, tags, performers, studios, tagDraft, setTagDraft, performerDraft, setPerformerDraft, studioDraft, setStudioDraft }: any) {
  return (
    <C.AppCol>
      <C.Section>
        <C.SectionHeader><C.SectionTitle>Tags</C.SectionTitle></C.SectionHeader>
        {tags.length === 0 && <C.AppDim>No tags yet.</C.AppDim>}
        <C.AppRow style={{ flexWrap: 'wrap', gap: 6 }}>
          {tags.map((t: Tag) => (
            <Pressable key={t.id} onPress={() => { removeTagFromMedia(db, media.id, t.id); bump(); }}>
              <C.AppBadge style={{ backgroundColor: t.color }}>
                <C.AppBadgeText style={{ color: '#0b1117' }}>{t.name} ×</C.AppBadgeText>
              </C.AppBadge>
            </Pressable>
          ))}
        </C.AppRow>
        <C.InlineEditRow style={{ paddingTop: 8 }}>
          <C.AppTextInput value={tagDraft} onChange={setTagDraft} placeholder="Add a tag…" style={{ flexGrow: 1 }} />
          <C.AppNavItem onPress={() => {
            if (!tagDraft.trim()) return;
            const id = ensureTag(db, tagDraft.trim());
            addTagToMedia(db, media.id, id);
            setTagDraft(''); bump();
          }}>Add</C.AppNavItem>
        </C.InlineEditRow>
      </C.Section>

      <C.Section>
        <C.SectionHeader><C.SectionTitle>Performers</C.SectionTitle></C.SectionHeader>
        {performers.length === 0 && <C.AppDim>No performers linked.</C.AppDim>}
        <C.AppRow style={{ flexWrap: 'wrap', gap: 6 }}>
          {performers.map((p: Performer) => (
            <Pressable key={p.id} onPress={() => { removePerformerFromMedia(db, media.id, p.id); bump(); }}>
              <C.AppBadge><C.AppBadgeText>{p.name} ×</C.AppBadgeText></C.AppBadge>
            </Pressable>
          ))}
        </C.AppRow>
        <C.InlineEditRow style={{ paddingTop: 8 }}>
          <C.AppTextInput value={performerDraft} onChange={setPerformerDraft} placeholder="Add performer…" style={{ flexGrow: 1 }} />
          <C.AppNavItem onPress={() => {
            if (!performerDraft.trim()) return;
            const id = ensurePerformer(db, performerDraft.trim());
            addPerformerToMedia(db, media.id, id);
            setPerformerDraft(''); bump();
          }}>Add</C.AppNavItem>
        </C.InlineEditRow>
      </C.Section>

      <C.Section>
        <C.SectionHeader><C.SectionTitle>Studios</C.SectionTitle></C.SectionHeader>
        {studios.length === 0 && <C.AppDim>No studios linked.</C.AppDim>}
        <C.AppRow style={{ flexWrap: 'wrap', gap: 6 }}>
          {studios.map((s: Studio) => (
            <Pressable key={s.id} onPress={() => { removeStudioFromMedia(db, media.id, s.id); bump(); }}>
              <C.AppBadge><C.AppBadgeText>{s.name} ×</C.AppBadgeText></C.AppBadge>
            </Pressable>
          ))}
        </C.AppRow>
        <C.InlineEditRow style={{ paddingTop: 8 }}>
          <C.AppTextInput value={studioDraft} onChange={setStudioDraft} placeholder="Add studio…" style={{ flexGrow: 1 }} />
          <C.AppNavItem onPress={() => {
            if (!studioDraft.trim()) return;
            const id = ensureStudio(db, studioDraft.trim());
            addStudioToMedia(db, media.id, id);
            setStudioDraft(''); bump();
          }}>Add</C.AppNavItem>
        </C.InlineEditRow>
      </C.Section>
    </C.AppCol>
  );
}

function CommentsTab({ media, db, bump, comments, commentDraft, setCommentDraft }: any) {
  return (
    <C.AppCol>
      {comments.length === 0 && (
        <C.EmptyState>
          <C.EmptyStateText>No comments yet</C.EmptyStateText>
          <C.AppDim>Be the first to leave a note.</C.AppDim>
        </C.EmptyState>
      )}
      {comments.map((c: Comment) => (
        <C.Section key={c.id}>
          <C.AppRow style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <C.AppCol style={{ flexGrow: 1 }}>
              <C.AppSubtle>{c.text}</C.AppSubtle>
              <C.AppDim style={{ fontSize: 11 }}>{formatDate(c.created_at)}</C.AppDim>
            </C.AppCol>
            <Pressable onPress={() => { deleteComment(db, c.id); bump(); }} style={{ padding: 4 }}>
              <C.AppDim>×</C.AppDim>
            </Pressable>
          </C.AppRow>
        </C.Section>
      ))}
      <C.InlineEditRow>
        <C.AppTextInput value={commentDraft} onChange={setCommentDraft} placeholder="Write a comment…" style={{ flexGrow: 1 }} />
        <C.AppNavItem onPress={() => {
          if (!commentDraft.trim()) return;
          addComment(db, media.id, commentDraft.trim());
          setCommentDraft(''); bump();
        }}>Post</C.AppNavItem>
      </C.InlineEditRow>
    </C.AppCol>
  );
}

// ═════════════════════════════════════════════════════════════
//  SETTINGS VIEW
// ═════════════════════════════════════════════════════════════

function SettingsView() {
  const db = dbRef.current;
  const [dirs, setDirs] = React.useState<ReturnType<typeof listScanDirs>>([]);
  const [newDir, setNewDir] = React.useState('');
  const [newDirRecursive, setNewDirRecursive] = React.useState(true);
  const [galleries, setGalleries] = React.useState<Gallery[]>([]);
  const [newGallery, setNewGallery] = React.useState('');
  const [tick, setTick] = React.useState(0);
  const bump = () => setTick((t) => t + 1);

  React.useEffect(() => {
    setDirs(listScanDirs(db));
    setGalleries(listGalleries(db));
  }, [tick]);

  const stats = React.useMemo(() => {
    const total = db.query<{ n: number }>(`SELECT COUNT(*) as n FROM media_items`)[0].n;
    const images = db.query<{ n: number }>(`SELECT COUNT(*) as n FROM media_items WHERE type = 'image'`)[0].n;
    const videos = db.query<{ n: number }>(`SELECT COUNT(*) as n FROM media_items WHERE type = 'video'`)[0].n;
    const audio = db.query<{ n: number }>(`SELECT COUNT(*) as n FROM media_items WHERE type = 'audio'`)[0].n;
    const favorites = db.query<{ n: number }>(`SELECT COUNT(*) as n FROM media_items WHERE favorite = 1`)[0].n;
    return { total, images, videos, audio, favorites };
  }, [tick]);

  return (
    <C.AppBody>
      {/* Stats */}
      <C.AppPanel style={{ flexGrow: 0 }}>
        <C.AppPanelTitle>Library Stats</C.AppPanelTitle>
        <C.AppRow style={{ flexWrap: 'wrap' }}>
          <StatCard value={stats.total} label="Total" />
          <StatCard value={stats.images} label="Images" />
          <StatCard value={stats.videos} label="Videos" />
          <StatCard value={stats.audio} label="Audio" />
          <StatCard value={stats.favorites} label="Favorites" />
        </C.AppRow>
      </C.AppPanel>

      {/* Directories */}
      <C.AppPanel style={{ flexGrow: 0 }}>
        <C.AppPanelTitle>Scan Directories</C.AppPanelTitle>
        <C.AppSubtle>Folders watched for new media. Changes are detected automatically.</C.AppSubtle>
        {dirs.length === 0 && <C.AppDim>No directories configured.</C.AppDim>}
        {dirs.map((d) => (
          <C.AppRow key={d.id} style={{ justifyContent: 'space-between', alignItems: 'center', paddingTop: 4, paddingBottom: 4 }}>
            <C.AppSubtle>{d.path} {d.recursive ? '(recursive)' : ''}</C.AppSubtle>
            <Pressable onPress={() => { removeScanDir(db, d.id); bump(); }}>
              <C.AppDim style={{ color: 'theme:error' }}>Remove</C.AppDim>
            </Pressable>
          </C.AppRow>
        ))}
        <C.InlineEditRow style={{ paddingTop: 8 }}>
          <C.AppTextInput value={newDir} onChange={setNewDir} placeholder="/path/to/folder" style={{ flexGrow: 1 }} />
          <C.AppNavItem onPress={() => setNewDirRecursive((r) => !r)}>
            <C.AppNavText>{newDirRecursive ? 'Recursive' : 'Flat'}</C.AppNavText>
          </C.AppNavItem>
          <C.AppNavItem onPress={() => {
            if (!newDir.trim()) return;
            addScanDir(db, newDir.trim(), newDirRecursive);
            setNewDir(''); bump();
          }}>Add</C.AppNavItem>
        </C.InlineEditRow>
      </C.AppPanel>

      {/* Galleries */}
      <C.AppPanel style={{ flexGrow: 0 }}>
        <C.AppPanelTitle>Galleries</C.AppPanelTitle>
        {galleries.length === 0 && <C.AppDim>No galleries yet.</C.AppDim>}
        {galleries.map((g) => (
          <C.AppRow key={g.id} style={{ justifyContent: 'space-between', alignItems: 'center', paddingTop: 4, paddingBottom: 4 }}>
            <C.AppSubtle>{g.name}</C.AppSubtle>
            <C.AppDim>{getGalleryMedia(db, g.id).length} items</C.AppDim>
          </C.AppRow>
        ))}
        <C.InlineEditRow style={{ paddingTop: 8 }}>
          <C.AppTextInput value={newGallery} onChange={setNewGallery} placeholder="New gallery name…" style={{ flexGrow: 1 }} />
          <C.AppNavItem onPress={() => {
            if (!newGallery.trim()) return;
            createGallery(db, newGallery.trim());
            setNewGallery(''); bump();
          }}>Create</C.AppNavItem>
        </C.InlineEditRow>
      </C.AppPanel>

      {/* Thumbnails */}
      <C.AppPanel style={{ flexGrow: 0 }}>
        <C.AppPanelTitle>Thumbnails</C.AppPanelTitle>
        <C.AppSubtle>Generated on demand and cached in ./thumbnails</C.AppSubtle>
        <C.AppNavItem onPress={() => {
          if (fs.exists('./thumbnails')) {
            for (const f of fs.listDir('./thumbnails')) fs.remove(`./thumbnails/${f}`);
          }
          bump();
        }}>
          <C.AppNavText>Clear thumbnail cache</C.AppNavText>
        </C.AppNavItem>
      </C.AppPanel>
    </C.AppBody>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <C.StatCard>
      <C.StatValue>{value}</C.StatValue>
      <C.StatLabel>{label}</C.StatLabel>
    </C.StatCard>
  );
}

// ═════════════════════════════════════════════════════════════
//  SHELL + ROUTER
// ═════════════════════════════════════════════════════════════

function Shell() {
  const nav = useNavigate();
  const route = useRoute();
  const isHome = route.path === '/';
  const isSettings = route.path === '/settings';

  return (
    <C.AppRoot>
      <C.AppShell>
        <C.AppHeader>
          <C.AppTitleBlock>
            <C.AppKicker>MEDIA LIBRARY</C.AppKicker>
            <C.AppTitle>Media</C.AppTitle>
          </C.AppTitleBlock>
          <C.AppNav>
            {!isHome && (
              <C.AppNavItem onPress={() => nav.push('/')}>
                <C.AppNavText>Browse</C.AppNavText>
              </C.AppNavItem>
            )}
            {!isSettings && (
              <C.AppNavItem onPress={() => nav.push('/settings')}>
                <C.AppNavText>Settings</C.AppNavText>
              </C.AppNavItem>
            )}
          </C.AppNav>
        </C.AppHeader>

        <Route path="/"><BrowseView /></Route>
        <Route path="/view/:path">{(params: any) => <DetailView path={decodeURIComponent(params.path)} />}</Route>
        <Route path="/settings"><SettingsView /></Route>
        <Route fallback>
          <C.AppPanel>
            <C.AppPanelTitle>Page not found</C.AppPanelTitle>
            <C.AppNavItem onPress={() => nav.push('/')}><C.AppNavText>Back to browse</C.AppNavText></C.AppNavItem>
          </C.AppPanel>
        </Route>
      </C.AppShell>
    </C.AppRoot>
  );
}

export default function App() {
  return (
    <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}>
      <Router initialPath="/">
        <Shell />
      </Router>
    </ThemeProvider>
  );
}
