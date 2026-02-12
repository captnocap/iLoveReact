/**
 * Terminal SQLite storage adapter.
 *
 * Uses Node.js v22+ built-in `node:sqlite` module for persistent
 * structured storage. Synchronous API wrapped in async interface
 * for consistency with other adapters.
 *
 * Data is stored in a SQLite database file (default: ./data.db).
 * Each collection gets its own table.
 */

import type { StorageAdapter, Query } from '../types';

export interface TerminalSQLiteOptions {
  /** Path to the SQLite database file. Default: './data.db' */
  dbPath?: string;
}

export class TerminalSQLiteAdapter implements StorageAdapter {
  private db: any; // DatabaseSync from node:sqlite

  constructor(options?: TerminalSQLiteOptions) {
    const dbPath = options?.dbPath ?? './data.db';

    // Dynamic import to avoid bundling issues — node:sqlite is Node.js-only
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(dbPath);

    // Create metadata table for tracking collections
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _collections (
        name TEXT PRIMARY KEY
      )
    `);
  }

  private ensureTable(collection: string): void {
    // Create table for collection if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${collection}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Register collection
    const insert = this.db.prepare('INSERT OR IGNORE INTO _collections (name) VALUES (?)');
    insert.run(collection);
  }

  async get(collection: string, id: string): Promise<any | null> {
    this.ensureTable(collection);
    const stmt = this.db.prepare(`SELECT data FROM "${collection}" WHERE id = ?`);
    const row = stmt.get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  async set(collection: string, id: string, data: any): Promise<void> {
    this.ensureTable(collection);
    const stmt = this.db.prepare(`
      INSERT INTO "${collection}" (id, data, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET data = ?, updated_at = datetime('now')
    `);
    const json = JSON.stringify({ ...data, id });
    stmt.run(id, json, json);
  }

  async delete(collection: string, id: string): Promise<boolean> {
    this.ensureTable(collection);
    const stmt = this.db.prepare(`DELETE FROM "${collection}" WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  async list(collection: string, query?: Query): Promise<any[]> {
    this.ensureTable(collection);

    // For simple cases, fetch all and filter in JS
    // This avoids SQL injection from dynamic where clauses
    const stmt = this.db.prepare(`SELECT data FROM "${collection}" ORDER BY created_at`);
    const rows = stmt.all() as { data: string }[];
    let items = rows.map(r => JSON.parse(r.data));

    // Apply query filtering in JS (safe from injection)
    if (query) {
      const { applyQuery } = require('../query');
      items = applyQuery(items, query);
    }

    return items;
  }

  /** Execute a raw SQL query with parameterized values. */
  async rawQuery(sql: string, params: any[] = []): Promise<any[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  /** Run a transaction. */
  async transaction(fn: () => Promise<void>): Promise<void> {
    this.db.exec('BEGIN');
    try {
      await fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Close the database. */
  close(): void {
    this.db.close();
  }
}
