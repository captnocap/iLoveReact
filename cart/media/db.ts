import { sqlite } from '../../runtime/hooks';
import { execAsync } from '../../runtime/hooks/process';

export async function extractDuration(path: string, type: MediaType): Promise<number | undefined> {
  if (type !== 'video' && type !== 'audio') return undefined;
  try {
    const r = await execAsync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${path}"`);
    if (r.code === 0) {
      const n = parseFloat(r.stdout.trim());
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {}
  return undefined;
}

const DB_PATH = './media.db';
const THUMB_DIR = './thumbnails';

export type MediaType = 'image' | 'video' | 'audio';

export type MediaItem = {
  id: number;
  path: string;
  parent_path: string;
  name: string;
  title: string;
  type: MediaType;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  mtime?: number;
  thumbnail_path?: string;
  favorite: boolean;
  organized: boolean;
  rating: number;
  notes: string;
  description: string;
  created_at: number;
  updated_at: number;
};

export type Tag = { id: number; name: string; color: string; alias_of?: number };
export type MediaTag = { media_id: number; tag_id: number };

export type Performer = {
  id: number;
  name: string;
  aliases: string;
  image_path?: string;
  favorite: boolean;
  notes: string;
  created_at: number;
};

export type Studio = {
  id: number;
  name: string;
  aliases: string;
  image_path?: string;
  favorite: boolean;
  notes: string;
  created_at: number;
};

export type MediaPerformer = { media_id: number; performer_id: number };
export type MediaStudio = { media_id: number; studio_id: number };

export type Gallery = {
  id: number;
  name: string;
  description: string;
  cover_media_id?: number;
  created_at: number;
};

export type GalleryItem = {
  gallery_id: number;
  media_id: number;
  sort_order: number;
  added_at: number;
};

export type Comment = {
  id: number;
  media_id: number;
  text: string;
  created_at: number;
};

export type ScanDirectory = {
  id: number;
  path: string;
  recursive: boolean;
  created_at: number;
};

export type AppSetting = {
  key: string;
  value: string;
};

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media_items (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  parent_path TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  title TEXT DEFAULT '',
  type TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  width INTEGER,
  height INTEGER,
  duration REAL,
  mtime INTEGER,
  thumbnail_path TEXT,
  favorite INTEGER DEFAULT 0,
  organized INTEGER DEFAULT 0,
  rating INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  description TEXT DEFAULT '',
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  color TEXT DEFAULT '#4ea1ff',
  alias_of INTEGER REFERENCES tags(id)
);

CREATE TABLE IF NOT EXISTS media_tags (
  media_id INTEGER REFERENCES media_items(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);

CREATE TABLE IF NOT EXISTS performers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  aliases TEXT DEFAULT '',
  image_path TEXT,
  favorite INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS studios (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  aliases TEXT DEFAULT '',
  image_path TEXT,
  favorite INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS media_performers (
  media_id INTEGER REFERENCES media_items(id) ON DELETE CASCADE,
  performer_id INTEGER REFERENCES performers(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, performer_id)
);

CREATE TABLE IF NOT EXISTS media_studios (
  media_id INTEGER REFERENCES media_items(id) ON DELETE CASCADE,
  studio_id INTEGER REFERENCES studios(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, studio_id)
);

CREATE TABLE IF NOT EXISTS galleries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  cover_media_id INTEGER REFERENCES media_items(id),
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS gallery_items (
  gallery_id INTEGER REFERENCES galleries(id) ON DELETE CASCADE,
  media_id INTEGER REFERENCES media_items(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  added_at INTEGER DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (gallery_id, media_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  media_id INTEGER REFERENCES media_items(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS scan_directories (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  recursive INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_metadata (
  media_id INTEGER REFERENCES media_items(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (media_id, key)
);

CREATE INDEX IF NOT EXISTS idx_media_parent ON media_items(parent_path);
CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_favorite ON media_items(favorite);
CREATE INDEX IF NOT EXISTS idx_media_organized ON media_items(organized);
CREATE INDEX IF NOT EXISTS idx_media_rating ON media_items(rating);
CREATE INDEX IF NOT EXISTS idx_media_mtime ON media_items(mtime);
CREATE INDEX IF NOT EXISTS idx_media_title ON media_items(title);
CREATE INDEX IF NOT EXISTS idx_tag_alias ON tags(alias_of);
CREATE INDEX IF NOT EXISTS idx_gallery_items ON gallery_items(gallery_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_comment_media ON comments(media_id);
`;

let _db: sqlite.Db | null = null;

export function getDb(): sqlite.Db {
  if (!_db) {
    _db = sqlite.Db.open(DB_PATH);
    initSchema(_db);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) { _db.close(); _db = null; }
}

export function initSchema(db: sqlite.Db): void {
  for (const stmt of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
    db.exec(stmt + ';');
  }
}

// ── Settings ─────────────────────────────────────────────────
export function getSetting(db: sqlite.Db, key: string, fallback = ''): string {
  const rows = db.query<{ value: string }>(`SELECT value FROM app_settings WHERE key = ?`, [key]);
  return rows[0]?.value ?? fallback;
}
export function setSetting(db: sqlite.Db, key: string, value: string): void {
  db.exec(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [key, value]);
}

// ── Scan Directories ─────────────────────────────────────────
export function listScanDirs(db: sqlite.Db): ScanDirectory[] {
  return db.query<ScanDirectory>(`SELECT * FROM scan_directories ORDER BY path`);
}
export function addScanDir(db: sqlite.Db, path: string, recursive = true): void {
  db.exec(`INSERT OR IGNORE INTO scan_directories (path, recursive) VALUES (?, ?)`, [path, recursive ? 1 : 0]);
}
export function removeScanDir(db: sqlite.Db, id: number): void {
  db.exec(`DELETE FROM scan_directories WHERE id = ?`, [id]);
}

// ── Media Items ──────────────────────────────────────────────
export function upsertMedia(
  db: sqlite.Db,
  item: Partial<MediaItem> & { path: string; name: string; type: MediaType; size: number },
): number {
  const existing = db.query<{ id: number }>(`SELECT id FROM media_items WHERE path = ?`, [item.path]);
  if (existing.length > 0) {
    const id = existing[0].id;
    const updates: string[] = [];
    const params: any[] = [];
    for (const [k, v] of Object.entries(item)) {
      if (k === 'id' || k === 'created_at' || v === undefined) continue;
      updates.push(`${k} = ?`);
      params.push(v);
    }
    if (updates.length > 0) {
      params.push(id);
      db.exec(`UPDATE media_items SET ${updates.join(', ')}, updated_at = strftime('%s', 'now') WHERE id = ?`, params);
    }
    return id;
  }
  const cols = Object.keys(item).filter((k) => (item as any)[k] !== undefined);
  const vals = cols.map((k) => (item as any)[k]);
  const placeholders = cols.map(() => '?').join(',');
  db.exec(`INSERT INTO media_items (${cols.join(',')}, created_at, updated_at) VALUES (${placeholders}, strftime('%s', 'now'), strftime('%s', 'now'))`, vals);
  return db.lastRowId();
}

export function getMediaByPath(db: sqlite.Db, path: string): MediaItem | null {
  const rows = db.query<MediaItem>(`SELECT * FROM media_items WHERE path = ?`, [path]);
  return rows[0] ?? null;
}

export function getMediaById(db: sqlite.Db, id: number): MediaItem | null {
  const rows = db.query<MediaItem>(`SELECT * FROM media_items WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export type ListMediaOpts = {
  types?: MediaType[];
  favorite?: boolean;
  organized?: boolean;
  minRating?: number;
  text?: string;
  tagIds?: number[];
  performerIds?: number[];
  studioIds?: number[];
  galleryId?: number;
  orderBy?: 'name' | 'mtime' | 'rating' | 'size' | 'created_at' | 'random';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

export function listMedia(db: sqlite.Db, opts: ListMediaOpts = {}): MediaItem[] {
  let sql = `SELECT DISTINCT m.* FROM media_items m`;
  const joins: string[] = [];
  const where: string[] = [];
  const params: any[] = [];

  if (opts.tagIds && opts.tagIds.length > 0) {
    joins.push(`JOIN media_tags mt ON mt.media_id = m.id`);
    where.push(`mt.tag_id IN (${opts.tagIds.map(() => '?').join(',')})`);
    params.push(...opts.tagIds);
  }
  if (opts.performerIds && opts.performerIds.length > 0) {
    joins.push(`JOIN media_performers mp ON mp.media_id = m.id`);
    where.push(`mp.performer_id IN (${opts.performerIds.map(() => '?').join(',')})`);
    params.push(...opts.performerIds);
  }
  if (opts.studioIds && opts.studioIds.length > 0) {
    joins.push(`JOIN media_studios ms ON ms.media_id = m.id`);
    where.push(`ms.studio_id IN (${opts.studioIds.map(() => '?').join(',')})`);
    params.push(...opts.studioIds);
  }
  if (opts.galleryId !== undefined) {
    joins.push(`JOIN gallery_items gi ON gi.media_id = m.id`);
    where.push(`gi.gallery_id = ?`);
    params.push(opts.galleryId);
  }

  if (opts.types && opts.types.length > 0) {
    where.push(`m.type IN (${opts.types.map(() => '?').join(',')})`);
    params.push(...opts.types);
  }
  if (opts.favorite !== undefined) { where.push(`m.favorite = ?`); params.push(opts.favorite ? 1 : 0); }
  if (opts.organized !== undefined) { where.push(`m.organized = ?`); params.push(opts.organized ? 1 : 0); }
  if (opts.minRating !== undefined && opts.minRating > 0) { where.push(`m.rating >= ?`); params.push(opts.minRating); }
  if (opts.text && opts.text.trim()) {
    const q = `%${opts.text.trim()}%`;
    where.push(`(m.name LIKE ? OR m.title LIKE ? OR m.description LIKE ? OR m.notes LIKE ?)`);
    params.push(q, q, q, q);
  }

  if (joins.length > 0) sql += ' ' + joins.join(' ');
  if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');

  const orderCol = opts.orderBy === 'random' ? 'RANDOM()' : `m.${opts.orderBy ?? 'mtime'}`;
  const orderDir = opts.order === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY ${orderCol} ${orderDir}`;

  if (opts.limit !== undefined) { sql += ` LIMIT ?`; params.push(opts.limit); }
  if (opts.offset !== undefined) { sql += ` OFFSET ?`; params.push(opts.offset); }

  return db.query<MediaItem>(sql, params);
}

export function toggleFavorite(db: sqlite.Db, id: number): void {
  db.exec(`UPDATE media_items SET favorite = NOT favorite, updated_at = strftime('%s', 'now') WHERE id = ?`, [id]);
}
export function toggleOrganized(db: sqlite.Db, id: number): void {
  db.exec(`UPDATE media_items SET organized = NOT organized, updated_at = strftime('%s', 'now') WHERE id = ?`, [id]);
}
export function setRating(db: sqlite.Db, id: number, rating: number): void {
  db.exec(`UPDATE media_items SET rating = ?, updated_at = strftime('%s', 'now') WHERE id = ?`, [rating, id]);
}
export function setNotes(db: sqlite.Db, id: number, notes: string): void {
  db.exec(`UPDATE media_items SET notes = ?, updated_at = strftime('%s', 'now') WHERE id = ?`, [notes, id]);
}
export function setDescription(db: sqlite.Db, id: number, description: string): void {
  db.exec(`UPDATE media_items SET description = ?, updated_at = strftime('%s', 'now') WHERE id = ?`, [description, id]);
}
export function setTitle(db: sqlite.Db, id: number, title: string): void {
  db.exec(`UPDATE media_items SET title = ?, updated_at = strftime('%s', 'now') WHERE id = ?`, [title, id]);
}

// ── Tags ─────────────────────────────────────────────────────
export function ensureTag(db: sqlite.Db, name: string, color?: string): number {
  db.exec(`INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color=COALESCE(?, tags.color)`, [name, color ?? '#4ea1ff', color ?? null]);
  const row = db.query<{ id: number }>(`SELECT id FROM tags WHERE name = ? COLLATE NOCASE`, [name]);
  return row[0]?.id ?? 0;
}
export function listTags(db: sqlite.Db): Tag[] {
  return db.query<Tag>(`SELECT * FROM tags ORDER BY name`);
}
export function getTagsForMedia(db: sqlite.Db, mediaId: number): Tag[] {
  return db.query<Tag>(`SELECT t.* FROM tags t JOIN media_tags mt ON mt.tag_id = t.id WHERE mt.media_id = ? ORDER BY t.name`, [mediaId]);
}
export function addTagToMedia(db: sqlite.Db, mediaId: number, tagId: number): void {
  db.exec(`INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)`, [mediaId, tagId]);
}
export function removeTagFromMedia(db: sqlite.Db, mediaId: number, tagId: number): void {
  db.exec(`DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?`, [mediaId, tagId]);
}

// ── Performers ───────────────────────────────────────────────
export function listPerformers(db: sqlite.Db): Performer[] {
  return db.query<Performer>(`SELECT * FROM performers ORDER BY name`);
}
export function ensurePerformer(db: sqlite.Db, name: string): number {
  db.exec(`INSERT OR IGNORE INTO performers (name) VALUES (?)`, [name]);
  const row = db.query<{ id: number }>(`SELECT id FROM performers WHERE name = ? COLLATE NOCASE`, [name]);
  return row[0]?.id ?? 0;
}
export function getPerformersForMedia(db: sqlite.Db, mediaId: number): Performer[] {
  return db.query<Performer>(`SELECT p.* FROM performers p JOIN media_performers mp ON mp.performer_id = p.id WHERE mp.media_id = ? ORDER BY p.name`, [mediaId]);
}
export function addPerformerToMedia(db: sqlite.Db, mediaId: number, performerId: number): void {
  db.exec(`INSERT OR IGNORE INTO media_performers (media_id, performer_id) VALUES (?, ?)`, [mediaId, performerId]);
}
export function removePerformerFromMedia(db: sqlite.Db, mediaId: number, performerId: number): void {
  db.exec(`DELETE FROM media_performers WHERE media_id = ? AND performer_id = ?`, [mediaId, performerId]);
}

// ── Studios ──────────────────────────────────────────────────
export function listStudios(db: sqlite.Db): Studio[] {
  return db.query<Studio>(`SELECT * FROM studios ORDER BY name`);
}
export function ensureStudio(db: sqlite.Db, name: string): number {
  db.exec(`INSERT OR IGNORE INTO studios (name) VALUES (?)`, [name]);
  const row = db.query<{ id: number }>(`SELECT id FROM studios WHERE name = ? COLLATE NOCASE`, [name]);
  return row[0]?.id ?? 0;
}
export function getStudiosForMedia(db: sqlite.Db, mediaId: number): Studio[] {
  return db.query<Studio>(`SELECT s.* FROM studios s JOIN media_studios ms ON ms.studio_id = s.id WHERE ms.media_id = ? ORDER BY s.name`, [mediaId]);
}
export function addStudioToMedia(db: sqlite.Db, mediaId: number, studioId: number): void {
  db.exec(`INSERT OR IGNORE INTO media_studios (media_id, studio_id) VALUES (?, ?)`, [mediaId, studioId]);
}
export function removeStudioFromMedia(db: sqlite.Db, mediaId: number, studioId: number): void {
  db.exec(`DELETE FROM media_studios WHERE media_id = ? AND studio_id = ?`, [mediaId, studioId]);
}

// ── Galleries ────────────────────────────────────────────────
export function listGalleries(db: sqlite.Db): Gallery[] {
  return db.query<Gallery>(`SELECT * FROM galleries ORDER BY name`);
}
export function createGallery(db: sqlite.Db, name: string, description = ''): number {
  db.exec(`INSERT INTO galleries (name, description) VALUES (?, ?)`, [name, description]);
  return db.lastRowId();
}
export function addToGallery(db: sqlite.Db, galleryId: number, mediaId: number, sortOrder?: number): void {
  db.exec(`INSERT OR IGNORE INTO gallery_items (gallery_id, media_id, sort_order) VALUES (?, ?, ?)`, [galleryId, mediaId, sortOrder ?? 0]);
}
export function getGalleryMedia(db: sqlite.Db, galleryId: number): MediaItem[] {
  return db.query<MediaItem>(`SELECT m.* FROM media_items m JOIN gallery_items gi ON gi.media_id = m.id WHERE gi.gallery_id = ? ORDER BY gi.sort_order, gi.added_at`, [galleryId]);
}
export function deleteGallery(db: sqlite.Db, id: number): void {
  db.exec(`DELETE FROM galleries WHERE id = ?`, [id]);
}

// ── Comments ─────────────────────────────────────────────────
export function listComments(db: sqlite.Db, mediaId: number): Comment[] {
  return db.query<Comment>(`SELECT * FROM comments WHERE media_id = ? ORDER BY created_at DESC`, [mediaId]);
}
export function addComment(db: sqlite.Db, mediaId: number, text: string): void {
  db.exec(`INSERT INTO comments (media_id, text) VALUES (?, ?)`, [mediaId, text]);
}
export function deleteComment(db: sqlite.Db, id: number): void {
  db.exec(`DELETE FROM comments WHERE id = ?`, [id]);
}

// ── Thumbnails ───────────────────────────────────────────────
const VIDEO_EXTS = new Set(['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'flv', 'm4v', 'mpg', 'mpeg', 'm2ts', 'mts', 'vob', 'ogv', '3gp']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff', 'tif', 'ico', 'heic', 'heif', 'avif', 'raw']);

export async function ensureThumbnail(path: string, type: MediaType): Promise<string | null> {
  // Defensive extension check: stale DB rows from older classifier versions
  // may have e.g. `.ts` rows tagged `video`. Without this guard we'd spawn
  // ffmpeg on a TypeScript source file and dump a multi-screen error on
  // startup. Trust the extension over the stored `type`.
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const fs = await import('../../runtime/hooks/fs');
  const { execAsync } = await import('../../runtime/hooks/process');
  if (!fs.exists(THUMB_DIR)) fs.mkdir(THUMB_DIR);
  const safe = path.replace(/[^a-zA-Z0-9]/g, '_');
  const out = `${THUMB_DIR}/${safe}.thumb.jpg`;
  if (fs.exists(out)) return out;
  if (type === 'image' && IMAGE_EXTS.has(ext)) {
    const r = await execAsync(`convert "${path}" -resize 320x240^ -gravity center -extent 320x240 "${out}"`);
    if (r.code === 0 && fs.exists(out)) return out;
  }
  if (type === 'video' && VIDEO_EXTS.has(ext)) {
    const r = await execAsync(`ffmpeg -i "${path}" -ss 00:00:01 -vframes 1 -s 320x240 -y "${out}"`);
    if (r.code === 0 && fs.exists(out)) return out;
  }
  return null;
}
