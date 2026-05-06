// Data route — storage engine prefs, Postgres bucket diagnostics, and
// localstore inspection/reset controls.

import { useEffect, useMemo, useState } from 'react';
import { Box, Pressable, ScrollView } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { callHost, hasHost } from '@reactjit/runtime/ffi';
import * as sqlite from '@reactjit/runtime/hooks/sqlite';
import * as pg from '@reactjit/runtime/hooks/pg';
import * as localstore from '@reactjit/runtime/hooks/localstore';
import {
  BUCKETS,
  BUCKET_IDS,
  ensureBootstrapped,
  entitiesByBucket,
  query as pgQuery,
  resetAll,
  resetBucket,
  type BucketId,
} from '../../db';
import { ident, tableName } from '../../db/sql';
import { DexBreadcrumbs } from '../../gallery/components/dex-breadcrumbs/DexBreadcrumbs';
import { DEX_COLORS, DexFrame } from '../../gallery/components/dex-frame/DexFrame';
import { DexSearchBar } from '../../gallery/components/dex-search-bar/DexSearchBar';
import { DexTableCell } from '../../gallery/components/dex-table-cell/DexTableCell';
import { DexTreeRow } from '../../gallery/components/dex-tree-row/DexTreeRow';
import type { DexValueType } from '../../gallery/components/dex-type-badge/DexTypeBadge';
import { Card, Field, Input, PillRow, Section, USER_ID, SETTINGS_ID } from '../shared';
import { useSettingsCtx } from '../page';

type EngineId = 'sqlite' | 'pg' | 'duckdb';
type ProbeResult = { ok: boolean; message: string };
type TableStatus = {
  entity: string;
  table: string;
  rows: number;
  ok: boolean;
  error?: string;
};
type BucketStatus = {
  id: BucketId;
  databaseName: string;
  description: string;
  ok: boolean;
  error?: string;
  tables: TableStatus[];
};
type PreviewTarget = { bucket: BucketId; entity: string };
type PreviewRow = { id: string; created_at?: string; updated_at?: string; data: any };

const EM_DASH = '-';
const ENGINE_OPTIONS: EngineId[] = ['pg', 'sqlite', 'duckdb'];
const ENGINE_LABELS: Record<EngineId, string> = {
  pg: 'Postgres',
  sqlite: 'SQLite',
  duckdb: 'DuckDB',
};
const KNOWN_LOCALSTORE_NAMESPACES = [
  'app',
  'settings',
  'gallery',
  'theme',
  'composer',
  'onboarding',
  'character',
  'prefs',
  'editor',
];

function nowIso(): string {
  return new Date().toISOString();
}

function defaultUserRow(): any {
  return {
    id: USER_ID,
    email: '',
    activeSettingsId: SETTINGS_ID,
    createdAt: nowIso(),
    preferences: {
      responseDefault: 'concise',
      elaborateOnAsk: true,
      emojiOk: false,
      accommodations: [],
    },
    onboarding: {
      status: 'pending',
      step: 0,
      startedAt: nowIso(),
    },
  };
}

function expandHomePath(path: string): string {
  if (!path.startsWith('~/')) return path;
  const home = hasHost('__env_get')
    ? callHost<string | null>('__env_get', null, 'HOME')
    : hasHost('__env')
      ? callHost<string | null>('__env', null, 'HOME')
      : null;
  return home ? `${home}/${path.slice(2)}` : path;
}

function fmtDate(iso: any): string {
  if (typeof iso !== 'string' || iso.length === 0) return EM_DASH;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]} UTC` : iso;
}

function truncate(v: any, max = 180): string {
  const raw = typeof v === 'string' ? v : JSON.stringify(v);
  if (!raw) return '';
  return raw.length > max ? `${raw.slice(0, max - 3)}...` : raw;
}

function statusText(ok: boolean): string {
  return ok ? 'ok' : 'fail';
}

function CountPill({ label }: { label: string }) {
  return (
    <S.Chip>
      <S.Body>{label}</S.Body>
    </S.Chip>
  );
}

function KV({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  const Text = mono ? S.Code : S.Body;
  return (
    <S.KV>
      <Box style={{ width: 164, flexShrink: 0 }}>
        <S.Body>{label}</S.Body>
      </Box>
      <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        <Text>{value == null || value === '' ? EM_DASH : String(value)}</Text>
      </Box>
    </S.KV>
  );
}

function valueType(value: any): DexValueType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object') return 'object';
  return 'string';
}

function rowTone(value: string | number): 'default' | 'number' | 'ok' | 'warn' | 'flag' | 'edit' {
  if (typeof value === 'number') return 'number';
  if (value === 'ok') return 'ok';
  if (value === 'fail') return 'flag';
  return 'default';
}

function MetricTile({ label, value, tone = 'default' }: {
  label: string;
  value: string | number;
  tone?: 'default' | 'ok' | 'warn' | 'flag';
}) {
  const color =
    tone === 'ok' ? DEX_COLORS.ok :
    tone === 'warn' ? DEX_COLORS.warn :
    tone === 'flag' ? DEX_COLORS.flag :
    DEX_COLORS.accent;
  return (
    <Box style={{
      flexGrow: 1,
      flexBasis: 120,
      minWidth: 0,
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 8,
      paddingBottom: 8,
      borderWidth: 1,
      borderColor: 'theme:rule',
      backgroundColor: 'theme:bg2',
      gap: 2,
    }}>
      <S.Caption>{label}</S.Caption>
      <S.Title style={{ color }}>{String(value)}</S.Title>
    </Box>
  );
}

function enginePref(user: any): any {
  return user?.preferences?.db || user?.database || {};
}

function EngineCard() {
  const { user, userStore, reload } = useSettingsCtx();
  const pref = enginePref(user);
  const [locators, setLocators] = useState({
    sqlite: pref.sqlitePath || '~/.reactjit/app.sqlite',
    duckdb: pref.duckdbPath || '~/.reactjit/app.duckdb',
    pg: pref.pgUri || 'embedded',
  });
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLocators({
      sqlite: pref.sqlitePath || '~/.reactjit/app.sqlite',
      duckdb: pref.duckdbPath || '~/.reactjit/app.duckdb',
      pg: pref.pgUri || 'embedded',
    });
  }, [pref.sqlitePath, pref.duckdbPath, pref.pgUri]);

  const writePref = async (patch: Record<string, any>) => {
    const cur = user || defaultUserRow();
    const prefs = cur.preferences || {};
    const nextDb = { ...(prefs.db || {}), ...(cur.database || {}), ...patch };
    const next = {
      ...cur,
      id: USER_ID,
      activeSettingsId: cur.activeSettingsId || SETTINGS_ID,
      createdAt: cur.createdAt || nowIso(),
      preferences: { ...prefs, db: nextDb },
      database: nextDb,
      onboarding: cur.onboarding || defaultUserRow().onboarding,
    };
    if (user) await userStore.update(USER_ID, next);
    else await userStore.create(next);
    reload();
  };

  const saveLocator = (engine: EngineId) => {
    if (engine === 'sqlite') return writePref({ sqlitePath: locators.sqlite || undefined });
    if (engine === 'duckdb') return writePref({ duckdbPath: locators.duckdb || undefined });
    return writePref({ pgUri: locators.pg || undefined });
  };

  const probe = async (engine: EngineId) => {
    setBusy((m) => ({ ...m, [engine]: true }));
    let result: ProbeResult;
    try {
      if (engine === 'sqlite') {
        const path = expandHomePath(locators.sqlite);
        const h = sqlite.open(path);
        if (h && h !== 0) {
          sqlite.close(h);
          result = { ok: true, message: `Opened ${path}.` };
        } else {
          result = { ok: false, message: `sqlite.open returned ${h}.` };
        }
      } else if (engine === 'pg') {
        if (!pg.isAvailable()) {
          result = { ok: false, message: 'Postgres host bindings are not registered.' };
        } else {
          const uri = locators.pg === 'embedded' ? '' : locators.pg;
          const h = pg.connect(uri);
          if (h && h !== 0) {
            pg.close(h);
            result = { ok: true, message: uri ? `Connected to ${uri}.` : 'Connected to embedded Postgres.' };
          } else {
            result = { ok: false, message: `pg.connect returned ${h}.` };
          }
        }
      } else {
        result = {
          ok: false,
          message: 'DuckDB libraries are present in deps, but no runtime hook is exposed yet.',
        };
      }
    } catch (e: any) {
      result = { ok: false, message: e?.message || String(e) };
    }
    setProbes((m) => ({ ...m, [engine]: result }));
    setBusy((m) => ({ ...m, [engine]: false }));
  };

  const activeEngine = (pref.engine || 'pg') as EngineId;

  return (
    <Card gap={14}>
      <Box style={{ flexDirection: 'column', gap: 2 }}>
        <S.Caption>Engine preference</S.Caption>
        <S.Subheading>Storage engines</S.Subheading>
      </Box>
      <Field label="Active engine">
        <PillRow<EngineId>
          options={ENGINE_OPTIONS}
          labels={ENGINE_LABELS}
          value={activeEngine}
          onChange={(v) => writePref({ engine: v })}
        />
      </Field>

      {ENGINE_OPTIONS.map((engine) => {
        const locatorKey = engine === 'pg' ? 'pg' : engine;
        const locatorLabel =
          engine === 'pg' ? 'Connection URI' : engine === 'sqlite' ? 'Database file' : 'Database file';
        const placeholder =
          engine === 'pg' ? 'embedded' : engine === 'sqlite' ? '~/.reactjit/app.sqlite' : '~/.reactjit/app.duckdb';
        const probed = probes[engine];
        return (
          <S.InputWell key={engine} style={{ gap: 8 }}>
            <Box style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <S.Subheading>{ENGINE_LABELS[engine]}</S.Subheading>
                {activeEngine === engine ? <CountPill label="active" /> : null}
                {probed ? <CountPill label={`probe ${statusText(probed.ok)}`} /> : null}
              </Box>
              <Box style={{ flexDirection: 'row', gap: 8 }}>
                <S.ButtonOutline onPress={() => saveLocator(engine)}>
                  <S.ButtonOutlineLabel>Save location</S.ButtonOutlineLabel>
                </S.ButtonOutline>
                <S.Button onPress={busy[engine] ? () => {} : () => probe(engine)}>
                  <S.ButtonLabel>{busy[engine] ? 'Probing...' : 'Probe'}</S.ButtonLabel>
                </S.Button>
              </Box>
            </Box>
            <Field label={locatorLabel}>
              <Input
                mono
                value={(locators as any)[locatorKey]}
                onChange={(v) => setLocators((m) => ({ ...m, [locatorKey]: v }))}
                placeholder={placeholder}
              />
            </Field>
            {probed ? (
              <S.AppProbeResult>
                {probed.ok ? <S.AppProbeOk>Probe succeeded</S.AppProbeOk> : <S.AppProbeFail>Probe failed</S.AppProbeFail>}
                <S.AppProbeMessage>{probed.message}</S.AppProbeMessage>
              </S.AppProbeResult>
            ) : null}
          </S.InputWell>
        );
      })}
    </Card>
  );
}

function PostgresCard() {
  const grouped = useMemo(() => entitiesByBucket(), []);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<BucketStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<PreviewTarget>({ bucket: 'user', entity: 'user' });
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState('');

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureBootstrapped();
      const next: BucketStatus[] = [];
      for (const id of BUCKET_IDS) {
        const bucket = BUCKETS[id];
        const entities = grouped[id] || [];
        const tables: TableStatus[] = [];
        let bucketOk = true;
        let bucketError = '';
        for (const entity of entities) {
          const table = tableName(entity);
          try {
            const rows = pgQuery<{ count: number | string }>(
              id,
              `SELECT COUNT(*) AS count FROM ${ident(table)}`,
            );
            tables.push({
              entity,
              table,
              rows: Number(rows[0]?.count || 0),
              ok: true,
            });
          } catch (e: any) {
            bucketOk = false;
            bucketError = bucketError || (e?.message || String(e));
            tables.push({
              entity,
              table,
              rows: 0,
              ok: false,
              error: e?.message || String(e),
            });
          }
        }
        next.push({
          id,
          databaseName: bucket.databaseName,
          description: bucket.description,
          ok: bucketOk,
          error: bucketError || undefined,
          tables,
        });
      }
      setStatus(next);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (nextTarget = target) => {
    setPreviewError(null);
    try {
      await ensureBootstrapped();
      const table = tableName(nextTarget.entity);
      const rows = pgQuery<PreviewRow>(
        nextTarget.bucket,
        `SELECT id, created_at, updated_at, data FROM ${ident(table)} ORDER BY updated_at DESC LIMIT 8`,
      );
      setPreview(rows);
    } catch (e: any) {
      setPreview([]);
      setPreviewError(e?.message || String(e));
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    loadPreview(target);
  }, [target.bucket, target.entity]);

  const runResetBucket = async (bucket: BucketId) => {
    const key = `pg:${bucket}`;
    if (confirm !== key) {
      setConfirm(key);
      return;
    }
    setConfirm(null);
    setError(null);
    try {
      await resetBucket(bucket);
      await loadStatus();
      await loadPreview(target);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const runResetAll = async () => {
    const key = 'pg:all';
    if (confirm !== key) {
      setConfirm(key);
      return;
    }
    setConfirm(null);
    setError(null);
    try {
      await resetAll();
      await loadStatus();
      await loadPreview(target);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const activeBucket = status.find((b) => b.id === target.bucket);
  const activeTables = activeBucket?.tables || [];
  const filteredTables = activeTables.filter((table) => {
    const needle = tableFilter.trim().toLowerCase();
    if (!needle) return true;
    return (
      table.entity.toLowerCase().includes(needle) ||
      table.table.toLowerCase().includes(needle) ||
      String(table.rows).includes(needle)
    );
  });
  const totalTables = status.reduce((n, b) => n + b.tables.length, 0);
  const totalRows = status.reduce((n, b) => n + b.tables.reduce((m, t) => m + t.rows, 0), 0);
  const badBuckets = status.filter((bucket) => !bucket.ok).length;
  const selectedTable = activeTables.find((table) => table.entity === target.entity);

  return (
    <Card gap={16}>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box style={{ flexDirection: 'column', gap: 2, flexShrink: 1 }}>
          <S.Caption>Postgres</S.Caption>
          <S.Subheading>Explorer</S.Subheading>
          <S.BodyDim>Pick one bucket, then one table. Row JSON stays in the preview pane.</S.BodyDim>
        </Box>
        <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <S.ButtonOutline onPress={loadStatus}>
            <S.ButtonOutlineLabel>{loading ? 'Refreshing...' : 'Refresh'}</S.ButtonOutlineLabel>
          </S.ButtonOutline>
          <S.ButtonOutline onPress={runResetAll}>
            <S.ButtonOutlineLabel>{confirm === 'pg:all' ? 'Confirm reset all' : 'Reset all PG buckets'}</S.ButtonOutlineLabel>
          </S.ButtonOutline>
        </Box>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <MetricTile label="binding" value={pg.isAvailable() ? 'ok' : 'missing'} tone={pg.isAvailable() ? 'ok' : 'flag'} />
        <MetricTile label="buckets" value={`${status.length}/${BUCKET_IDS.length}`} tone={badBuckets > 0 ? 'warn' : 'default'} />
        <MetricTile label="tables" value={totalTables} />
        <MetricTile label="rows" value={totalRows} />
      </Box>

      {error ? (
        <S.AppProbeResult>
          <S.AppProbeFail>Postgres status failed</S.AppProbeFail>
          <S.AppProbeMessage>{error}</S.AppProbeMessage>
        </S.AppProbeResult>
      ) : null}

      <DexFrame
        id="PG"
        title="bucket / table explorer"
        width="100%"
        height={620}
        right={
          <Box style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <CountPill label={activeBucket?.databaseName || 'cart_user'} />
            <CountPill label={`${activeTables.length} tables`} />
          </Box>
        }
        footer={
          <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <DexBreadcrumbs items={['postgres', target.bucket, target.entity]} />
            <S.TinyDim>{selectedTable ? `${selectedTable.rows} rows` : 'no table selected'}</S.TinyDim>
          </Box>
        }
      >
        <Box style={{ flexDirection: 'row', height: '100%', minHeight: 0 }}>
          <Box style={{
            width: 246,
            flexShrink: 0,
            borderRightWidth: 1,
            borderRightColor: 'theme:rule',
            backgroundColor: 'theme:bg',
          }}>
            <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: 'theme:rule' }}>
              <S.Caption>Buckets</S.Caption>
            </Box>
            <ScrollView showScrollbar style={{ width: '100%', height: 534 }}>
              <Box style={{ flexDirection: 'column' }}>
                {status.map((bucket) => {
                  const rowCount = bucket.tables.reduce((n, table) => n + table.rows, 0);
                  return (
                    <DexTreeRow
                      key={bucket.id}
                      depth={0}
                      label={bucket.id}
                      value={`${rowCount} rows`}
                      type="object"
                      container
                      open={bucket.id === target.bucket}
                      selected={bucket.id === target.bucket}
                      edited={!bucket.ok}
                      onPress={() => {
                        const firstEntity = bucket.tables[0]?.entity || (grouped[bucket.id] || ['user'])[0];
                        setTarget({ bucket: bucket.id, entity: firstEntity });
                      }}
                    />
                  );
                })}
              </Box>
            </ScrollView>
          </Box>

          <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, flexDirection: 'column' }}>
            <DexSearchBar
              value={tableFilter}
              onChange={setTableFilter}
              placeholder={`filter ${target.bucket} tables`}
              count={`${filteredTables.length}/${activeTables.length}`}
            />

            <Box style={{ flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
              <Box style={{
                width: 286,
                flexShrink: 0,
                borderRightWidth: 1,
                borderRightColor: 'theme:rule',
                backgroundColor: 'theme:bg',
              }}>
                <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: 'theme:rule' }}>
                  <S.Caption>{target.bucket}</S.Caption>
                  <S.BodyDim>{activeBucket?.description || BUCKETS[target.bucket].description}</S.BodyDim>
                </Box>
                <ScrollView showScrollbar style={{ width: '100%', height: 474 }}>
                  <Box style={{ flexDirection: 'column' }}>
                    {filteredTables.length === 0 ? (
                      <Box style={{ padding: 12 }}>
                        <S.BodyDim>No matching tables.</S.BodyDim>
                      </Box>
                    ) : null}
                    {filteredTables.map((table) => (
                      <DexTreeRow
                        key={table.entity}
                        depth={1}
                        label={table.entity}
                        value={table.ok ? `${table.rows} rows` : 'query failed'}
                        type={table.ok ? 'number' : 'null'}
                        selected={table.entity === target.entity}
                        edited={!table.ok || table.rows > 0}
                        onPress={() => setTarget({ bucket: target.bucket, entity: table.entity })}
                      />
                    ))}
                  </Box>
                </ScrollView>
                <Box style={{ padding: 10, borderTopWidth: 1, borderTopColor: 'theme:rule' }}>
                  <S.ButtonOutline onPress={() => runResetBucket(target.bucket)}>
                    <S.ButtonOutlineLabel>
                      {confirm === `pg:${target.bucket}` ? 'Confirm reset bucket' : 'Reset selected bucket'}
                    </S.ButtonOutlineLabel>
                  </S.ButtonOutline>
                </Box>
              </Box>

              <Box style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, flexDirection: 'column' }}>
                <Box style={{
                  flexDirection: 'row',
                  gap: 8,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingLeft: 10,
                  paddingRight: 10,
                  paddingTop: 8,
                  paddingBottom: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: 'theme:rule',
                  backgroundColor: 'theme:bg1',
                }}>
                  <Box style={{ flexDirection: 'column', gap: 2, minWidth: 0, flexShrink: 1 }}>
                    <S.Caption>Preview</S.Caption>
                    <S.Subheading>{target.entity}</S.Subheading>
                  </Box>
                  <S.ButtonOutline onPress={() => loadPreview()}>
                    <S.ButtonOutlineLabel>Refresh rows</S.ButtonOutlineLabel>
                  </S.ButtonOutline>
                </Box>

                {previewError ? (
                  <S.AppProbeResult>
                    <S.AppProbeFail>Preview failed</S.AppProbeFail>
                    <S.AppProbeMessage>{previewError}</S.AppProbeMessage>
                  </S.AppProbeResult>
                ) : null}

                <Box style={{ flexDirection: 'row', height: 26, borderBottomWidth: 1, borderBottomColor: 'theme:rule' }}>
                  <DexTableCell value="id" flex={0.85} tone="edit" />
                  <DexTableCell value="updated" flex={0.62} tone="edit" />
                  <DexTableCell value="jsonb data" flex={2.1} tone="edit" />
                </Box>

                <ScrollView showScrollbar style={{ width: '100%', flexGrow: 1, minHeight: 0 }}>
                  <Box style={{ flexDirection: 'column' }}>
                    {preview.length === 0 && !previewError ? (
                      <Box style={{ padding: 12 }}>
                        <S.BodyDim>No rows in this table.</S.BodyDim>
                      </Box>
                    ) : null}
                    {preview.map((row, index) => (
                      <Box key={row.id} style={{ flexDirection: 'row' }}>
                        <DexTableCell value={truncate(row.id, 28)} flex={0.85} selected={index === 0} />
                        <DexTableCell value={fmtDate(row.updated_at)} flex={0.62} tone="number" selected={index === 0} />
                        <DexTableCell
                          value={truncate(row.data, 180)}
                          flex={2.1}
                          tone={rowTone(typeof row.data === 'object' ? valueType(row.data) : 'default')}
                          selected={index === 0}
                        />
                      </Box>
                    ))}
                  </Box>
                </ScrollView>

                {preview[0] ? (
                  <Box style={{
                    borderTopWidth: 1,
                    borderTopColor: 'theme:rule',
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingTop: 8,
                    paddingBottom: 8,
                    gap: 4,
                    backgroundColor: 'theme:bg1',
                  }}>
                    <S.Caption>Selected row detail</S.Caption>
                    <KV label="id" value={preview[0].id} mono />
                    <KV label="created" value={fmtDate(preview[0].created_at)} />
                    <KV label="updated" value={fmtDate(preview[0].updated_at)} />
                    <KV label="data" value={truncate(preview[0].data, 520)} mono />
                  </Box>
                ) : null}
              </Box>
            </Box>
          </Box>
        </Box>
      </DexFrame>
    </Card>
  );
}

function LocalstoreCard() {
  const [legacyKeys, setLegacyKeys] = useState<string[]>([]);
  const [namespaces, setNamespaces] = useState<Record<string, string[]>>({});
  const [selectedLegacy, setSelectedLegacy] = useState<string>('');
  const [selectedNs, setSelectedNs] = useState('app');
  const [selectedNsKey, setSelectedNsKey] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = () => {
    const legacy = hasHost('__store_keys_json') ? localstore.keys() : [];
    const nextNs: Record<string, string[]> = {};
    if (hasHost('__localstoreKeysJson')) {
      for (const ns of KNOWN_LOCALSTORE_NAMESPACES) {
        const keys = localstore.nsKeys(ns);
        if (keys.length > 0 || ns === 'app') nextNs[ns] = keys;
      }
    }
    const nextSelectedNs = nextNs[selectedNs] ? selectedNs : Object.keys(nextNs)[0] || 'app';
    setLegacyKeys(legacy);
    setNamespaces(nextNs);
    setSelectedLegacy((k) => legacy.includes(k) ? k : legacy[0] || '');
    setSelectedNs(nextSelectedNs);
    setSelectedNsKey((k) => nextNs[nextSelectedNs]?.includes(k) ? k : nextNs[nextSelectedNs]?.[0] || '');
  };

  useEffect(() => {
    load();
  }, []);

  const legacyValue = selectedLegacy && hasHost('__store_get')
    ? localstore.get(selectedLegacy)
    : '';
  const nsKeys = namespaces[selectedNs] || [];
  const nsValue = selectedNsKey && hasHost('__localstoreGet')
    ? localstore.nsGet(selectedNs, selectedNsKey)
    : '';

  const clearLegacy = () => {
    if (confirm !== 'legacy') {
      setConfirm('legacy');
      return;
    }
    setConfirm(null);
    localstore.clear();
    load();
  };

  const clearNamespace = (ns: string) => {
    const key = `ns:${ns}`;
    if (confirm !== key) {
      setConfirm(key);
      return;
    }
    setConfirm(null);
    localstore.nsClear(ns);
    load();
  };

  const clearAllNamespaced = () => {
    if (confirm !== 'ns:all') {
      setConfirm('ns:all');
      return;
    }
    setConfirm(null);
    localstore.nsClear('');
    load();
  };

  const namespaceOptions = Object.keys(namespaces).length > 0
    ? Object.keys(namespaces)
    : ['app'];

  return (
    <Card gap={16}>
      <Box style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box style={{ flexDirection: 'column', gap: 2, flexShrink: 1 }}>
          <S.Caption>Localstore</S.Caption>
          <S.Subheading>SQLite-backed key/value stores</S.Subheading>
          <S.BodyDim>Legacy single-key store plus V8 namespaced localstore.</S.BodyDim>
        </Box>
        <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <S.ButtonOutline onPress={load}>
            <S.ButtonOutlineLabel>Refresh</S.ButtonOutlineLabel>
          </S.ButtonOutline>
          <S.ButtonOutline onPress={clearAllNamespaced}>
            <S.ButtonOutlineLabel>{confirm === 'ns:all' ? 'Confirm clear all namespaces' : 'Clear all namespaces'}</S.ButtonOutlineLabel>
          </S.ButtonOutline>
        </Box>
      </Box>

      <Box style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <CountPill label={hasHost('__store_keys_json') ? 'legacy store ok' : 'legacy store missing'} />
        <CountPill label={hasHost('__localstoreKeysJson') ? 'namespaced store ok' : 'namespaced store missing'} />
        <CountPill label={`${legacyKeys.length} legacy keys`} />
        <CountPill label={`${Object.values(namespaces).reduce((n, keys) => n + keys.length, 0)} namespaced keys`} />
      </Box>

      <S.InputWell style={{ gap: 10 }}>
        <Box style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <S.Subheading>Legacy keys</S.Subheading>
          <S.ButtonOutline onPress={clearLegacy}>
            <S.ButtonOutlineLabel>{confirm === 'legacy' ? 'Confirm clear legacy' : 'Clear legacy store'}</S.ButtonOutlineLabel>
          </S.ButtonOutline>
        </Box>
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {legacyKeys.length === 0 ? <S.BodyDim>No legacy keys.</S.BodyDim> : null}
          {legacyKeys.map((key) => {
            const isTarget = key === selectedLegacy;
            const Chip = isTarget ? S.AppTraitChipActive : S.AppTraitChip;
            const Label = isTarget ? S.AppTraitChipTextActive : S.AppTraitChipText;
            return (
              <Pressable key={key} onPress={() => setSelectedLegacy(key)}>
                <Chip><Label>{key}</Label></Chip>
              </Pressable>
            );
          })}
        </Box>
        {selectedLegacy ? <KV label={selectedLegacy} value={truncate(legacyValue, 520)} mono /> : null}
      </S.InputWell>

      <S.InputWell style={{ gap: 10 }}>
        <Box style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <S.Subheading>Namespaced keys</S.Subheading>
          <S.ButtonOutline onPress={() => clearNamespace(selectedNs)}>
            <S.ButtonOutlineLabel>
              {confirm === `ns:${selectedNs}` ? `Confirm clear ${selectedNs}` : `Clear ${selectedNs}`}
            </S.ButtonOutlineLabel>
          </S.ButtonOutline>
        </Box>
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {namespaceOptions.map((ns) => {
            const isTarget = ns === selectedNs;
            const Chip = isTarget ? S.AppTraitChipActive : S.AppTraitChip;
            const Label = isTarget ? S.AppTraitChipTextActive : S.AppTraitChipText;
            return (
              <Pressable
                key={ns}
                onPress={() => {
                  setSelectedNs(ns);
                  setSelectedNsKey((namespaces[ns] || [])[0] || '');
                }}
              >
                <Chip><Label>{ns} ({(namespaces[ns] || []).length})</Label></Chip>
              </Pressable>
            );
          })}
        </Box>
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {nsKeys.length === 0 ? <S.BodyDim>No keys in this namespace.</S.BodyDim> : null}
          {nsKeys.map((key) => {
            const isTarget = key === selectedNsKey;
            const Chip = isTarget ? S.AppTraitChipActive : S.AppTraitChip;
            const Label = isTarget ? S.AppTraitChipTextActive : S.AppTraitChipText;
            return (
              <Pressable key={key} onPress={() => setSelectedNsKey(key)}>
                <Chip><Label>{key}</Label></Chip>
              </Pressable>
            );
          })}
        </Box>
        {selectedNsKey ? <KV label={`${selectedNs}:${selectedNsKey}`} value={truncate(nsValue, 520)} mono /> : null}
      </S.InputWell>
    </Card>
  );
}

export default function DataRoute() {
  return (
    <Section caption="Storage" title="Data">
      <Box style={{ flexDirection: 'column', gap: 16 }}>
        <EngineCard />
        <PostgresCard />
        <LocalstoreCard />
      </Box>
    </Section>
  );
}
