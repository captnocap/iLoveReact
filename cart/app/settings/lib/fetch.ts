// fetch.ts — pull a live model list from one connection and turn it
// into model-registry rows (option A schema, see routes/models.tsx).
//
// Five connection kinds, three fetch strategies:
//   anthropic-api-key   → GET endpoint/models  (x-api-key + version)
//   openai-api-key      → GET endpoint/models  (Bearer)
//   openai-api-like     → GET endpoint/models  (Bearer, custom endpoint)
//   claude-code-cli     → read OAuth token from <auth>/.credentials.json,
//                         then GET https://api.anthropic.com/v1/models
//                         with Bearer + anthropic-beta:oauth-2025-04-20
//   local-runtime       → walk the configured folder ≤5 levels for .gguf
//
// Modality is inferred from the remote id (embedding/whisper/tts/image
// keywords). Default is 'text'.

import * as http from '@reactjit/runtime/hooks/fetch';
import * as fs from '@reactjit/runtime/hooks/fs';
import { execAsync, envGet } from '@reactjit/runtime/hooks/process';
import { lookupModel, type Modality } from './modelRegistry';

export type { Modality };

export type ModelRow = {
  id: string;                // `${connectionId}:${remoteId}`
  connectionId: string;
  remoteId: string;
  displayName: string;
  modality: Modality;
  contextLength?: number;
  favorite: boolean;
  custom: boolean;           // true if user added by hand (not via fetch)
  lastSeenIso: string;
  source: 'remote-list' | 'gguf-walk' | 'manual';
};

export type FetchResult = {
  ok: boolean;
  message: string;
  rows: ModelRow[];
};

function expandHome(p: string): string {
  const v = String(p || '').trim();
  if (!v) return v;
  if (v.startsWith('~/') || v === '~') {
    const home = envGet('HOME') || '';
    if (home) return v === '~' ? home : `${home}/${v.slice(2)}`;
  }
  return v;
}

function inferModality(id: string): Modality {
  // Registry knows the truth for known models; fall through to keyword
  // heuristic for anything unrecognised (custom fine-tunes, etc.).
  const hit = lookupModel(id);
  if (hit) return hit.modality;
  const s = id.toLowerCase();
  if (s.includes('embed')) return 'embed';
  if (s.includes('whisper')) return 'voice';
  if (s.includes('tts') || s.includes('-speech') || s.includes('voice-')) return 'tts';
  if (s.includes('dall-e') || s.includes('flux') || s.includes('stable-diffusion') || s.includes('sd-') || s.includes('image-gen')) return 'image';
  return 'text';
}

// Apply registry metadata to a freshly-fetched row, before it lands in
// the store. New rows get clean display names and registry-correct
// modality/context up front.
function enrichWithRegistry(row: ModelRow): ModelRow {
  const hit = lookupModel(row.remoteId);
  if (!hit) return row;
  return {
    ...row,
    modality:      hit.modality,
    contextLength: hit.contextLength ?? row.contextLength,
    displayName:   hit.displayName || row.displayName,
  };
}

function parseModelList(body: string): { id: string; ctx?: number }[] {
  try {
    const obj = JSON.parse(body);
    const arr = Array.isArray(obj?.data) ? obj.data
              : Array.isArray(obj?.models) ? obj.models
              : Array.isArray(obj) ? obj
              : null;
    if (!arr) return [];
    const out: { id: string; ctx?: number }[] = [];
    for (const m of arr) {
      let id: string | null = null;
      let ctx: number | undefined;
      if (typeof m === 'string') id = m;
      else if (m && typeof m === 'object') {
        id = m.id || m.model || m.name || m.modelName || null;
        const c = m.context_length || m.context_window || m.contextLength || m.max_context_length;
        if (typeof c === 'number') ctx = c;
      }
      if (id) out.push({ id, ctx });
    }
    return out;
  } catch {
    return [];
  }
}

function authHeaders(internalKind: string, key: string): Record<string, string> {
  if (internalKind === 'anthropic-api-key') {
    return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  }
  return { Authorization: `Bearer ${key}` };
}

function defaultEndpointFor(internalKind: string): string {
  switch (internalKind) {
    case 'anthropic-api-key': return 'https://api.anthropic.com/v1';
    case 'openai-api-key':    return 'https://api.openai.com/v1';
    case 'openai-api-like':   return 'http://localhost:11434/v1';
    case 'kimi-api-key':      return 'https://api.moonshot.cn/v1';
    default: return '';
  }
}

function walkForGgufs(root: string, maxDepth = 5, maxFiles = 200): string[] {
  const rs = fs.stat(root);
  if (!rs) return [];
  if (!rs.isDir && root.toLowerCase().endsWith('.gguf')) return [root];

  const out: string[] = [];
  const queue: { path: string; depth: number }[] = [{ path: root, depth: 0 }];
  while (queue.length > 0 && out.length < maxFiles) {
    const { path, depth } = queue.shift()!;
    let entries: string[] = [];
    try { entries = fs.listDir(path) || []; } catch { continue; }
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const full = `${path}/${name}`;
      const st = fs.stat(full);
      if (!st) continue;
      if (st.isDir) {
        if (depth < maxDepth) queue.push({ path: full, depth: depth + 1 });
      } else if (name.toLowerCase().endsWith('.gguf')) {
        const lower = name.toLowerCase();
        if (lower.includes('mmproj') || lower.includes('-projector')) continue;
        out.push(full);
        if (out.length >= maxFiles) break;
      }
    }
  }
  out.sort();
  return out;
}

function ggufDisplayName(fullPath: string): string {
  const base = fullPath.split('/').pop() || fullPath;
  return base.replace(/\.gguf$/i, '');
}

async function resolveEnvKey(envName: string): Promise<{ ok: boolean; value?: string; message?: string }> {
  const name = (envName || '').trim();
  if (!name) return { ok: false, message: 'API key env var name is empty.' };
  const val = envGet(name);
  if (!val) return { ok: false, message: `Env var ${name} is unset or empty in the cart's process environment.` };
  return { ok: true, value: val };
}

async function fetchHttpModels(
  connectionId: string,
  internalKind: string,
  endpoint: string,
  key: string,
): Promise<FetchResult> {
  const base = (endpoint || defaultEndpointFor(internalKind) || '').replace(/\/+$/, '');
  if (!base) return { ok: false, message: 'Missing endpoint URL.', rows: [] };
  const url = `${base}/models`;
  const headers = authHeaders(internalKind, key);
  const res = await http.getAsync(url, headers).catch((err: any) => ({
    status: 0, headers: {}, body: '', error: String(err?.message || err),
  }));
  if (!res || typeof res.status !== 'number' || res.status === 0) {
    return { ok: false, message: `GET ${url} failed: ${(res as any)?.error || 'no response'}`, rows: [] };
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, message: `GET ${url} → ${res.status}\n${(res.body || '').slice(0, 600)}`, rows: [] };
  }
  const parsed = parseModelList(res.body);
  if (parsed.length === 0) {
    return { ok: false, message: `Endpoint replied ${res.status} but no models parsed.`, rows: [] };
  }
  const now = new Date().toISOString();
  const rows: ModelRow[] = parsed.map((p) => ({
    id: `${connectionId}:${p.id}`,
    connectionId,
    remoteId: p.id,
    displayName: p.id,
    modality: inferModality(p.id),
    contextLength: p.ctx,
    favorite: false,
    custom: false,
    lastSeenIso: now,
    source: 'remote-list',
  }));
  return { ok: true, message: `${rows.length} models from ${url}`, rows };
}

async function fetchClaudeCodeModels(connectionId: string, authDir: string): Promise<FetchResult> {
  const home = (authDir || '~/.claude/').replace(/\/+$/, '');
  const catCmd = home.startsWith('~/')
    ? `cat "$HOME${home.slice(1)}/.credentials.json"`
    : `cat "${home}/.credentials.json"`;
  const cat = await execAsync(catCmd).catch((err: any) => ({ code: 1, stdout: '', stderr: String(err?.message || err) }));
  if (!cat || cat.code !== 0) {
    return { ok: false, message: `No credentials.json under ${home}. Run \`claude auth login\`.`, rows: [] };
  }
  let token = '';
  try {
    const j = JSON.parse(cat.stdout);
    token = (j?.claudeAiOauth?.accessToken) || '';
  } catch {
    return { ok: false, message: 'credentials.json was not valid JSON.', rows: [] };
  }
  if (!token) return { ok: false, message: 'No accessToken in credentials.json.', rows: [] };

  const res = await http.getAsync('https://api.anthropic.com/v1/models', {
    Authorization: `Bearer ${token}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'oauth-2025-04-20',
  }).catch((err: any) => ({ status: 0, headers: {}, body: '', error: String(err?.message || err) }));
  if (!res || res.status === 0) return { ok: false, message: `GET /v1/models failed: ${(res as any)?.error || 'no response'}`, rows: [] };
  if (res.status === 401) return { ok: false, message: 'Token rejected (401). Run `claude auth login` again.', rows: [] };
  if (res.status !== 200) return { ok: false, message: `Anthropic /v1/models → ${res.status}: ${(res.body || '').slice(0, 200)}`, rows: [] };

  const parsed = parseModelList(res.body);
  if (parsed.length === 0) return { ok: false, message: 'Replied 200 but no models parsed.', rows: [] };
  const now = new Date().toISOString();
  const rows: ModelRow[] = parsed.map((p) => ({
    id: `${connectionId}:${p.id}`,
    connectionId,
    remoteId: p.id,
    displayName: p.id,
    modality: inferModality(p.id),
    contextLength: p.ctx,
    favorite: false,
    custom: false,
    lastSeenIso: now,
    source: 'remote-list',
  }));
  return { ok: true, message: `${rows.length} models via Claude Code OAuth`, rows };
}

function fetchLocalGgufs(connectionId: string, folder: string): FetchResult {
  const raw = (folder || '').trim();
  if (!raw) return { ok: false, message: 'Set the models folder.', rows: [] };
  const root = expandHome(raw);
  if (!fs.exists(root)) return { ok: false, message: `Folder not found: ${root}`, rows: [] };
  const ggufs = walkForGgufs(root, 5, 200);
  if (ggufs.length === 0) return { ok: false, message: `No .gguf files under ${root} (≤5 levels, capped at 200).`, rows: [] };
  const now = new Date().toISOString();
  const rows: ModelRow[] = ggufs.map((p) => ({
    id: `${connectionId}:${p}`,
    connectionId,
    remoteId: p,
    displayName: ggufDisplayName(p),
    modality: inferModality(p),
    favorite: false,
    custom: false,
    lastSeenIso: now,
    source: 'gguf-walk',
  }));
  return { ok: true, message: `Found ${rows.length} .gguf file${rows.length === 1 ? '' : 's'} under ${root}`, rows };
}

export async function fetchModelsFor(conn: any): Promise<FetchResult> {
  const id = conn.id;
  const kind = conn.kind;
  const cr = conn.credentialRef || {};

  if (kind === 'claude-code-cli') {
    return fetchClaudeCodeModels(id, cr.locator || '~/.claude/');
  }
  if (kind === 'codex-cli') {
    // The `codex` CLI doesn't expose a "list models" endpoint — the active
    // model is set in `~/.codex/config.toml` and surfaced through the
    // app-server's `agent.session.start` response. The cart's model picker
    // renders the static Codex roster from modelRegistry.ts directly, so
    // this fetch is intentionally a no-op success.
    return { ok: true, message: 'Codex models surface from the static registry — no fetch needed.', rows: [] };
  }
  if (kind === 'local-runtime') {
    return fetchLocalGgufs(id, cr.locator || '');
  }
  // HTTP api-key kinds.
  if (cr.source === 'env') {
    const key = await resolveEnvKey(cr.locator || '');
    if (!key.ok) return { ok: false, message: key.message || 'Failed to resolve key.', rows: [] };
    return fetchHttpModels(id, kind, conn.endpoint || '', key.value!);
  }
  return { ok: false, message: `Unsupported credential source: ${cr.source}`, rows: [] };
}

// Upsert a fetched batch into the model store, preserving favorite +
// any user-edited displayName. Registry hits override modality and
// contextLength on every refresh — those facts are lab-defined, not
// user-defined, so the registry is the source of truth even for
// already-stored rows whose values may be wrong from a prior infer.
export async function upsertRows(modelStore: any, rows: ModelRow[]): Promise<{ added: number; refreshed: number }> {
  let added = 0, refreshed = 0;
  for (const r of rows) {
    const enriched = enrichWithRegistry(r);
    const hit = lookupModel(r.remoteId);
    const existing = await modelStore.get(r.id).catch(() => null);
    if (existing) {
      // Preserve user-edited displayName (anything not equal to the
      // raw remoteId or the prior enriched name is treated as an edit).
      const userEdited =
        existing.displayName &&
        existing.displayName !== existing.remoteId &&
        existing.displayName !== hit?.displayName;
      await modelStore.update(r.id, {
        ...existing,
        modality:      hit?.modality ?? existing.modality,
        contextLength: hit?.contextLength ?? r.contextLength ?? existing.contextLength,
        displayName:   userEdited ? existing.displayName : (hit?.displayName || existing.displayName),
        lastSeenIso:   r.lastSeenIso,
        source:        r.source,
      });
      refreshed += 1;
    } else {
      await modelStore.create(enriched);
      added += 1;
    }
  }
  return { added, refreshed };
}
