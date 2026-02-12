/**
 * Web storage adapters.
 *
 * LocalStorageAdapter — Simple key-value using localStorage.
 *   Best for small amounts of data (< 5MB total).
 *
 * IndexedDBAdapter — Full async database using IndexedDB.
 *   Better for larger datasets, supports structured queries.
 */

import type { StorageAdapter, Query } from '../types';
import { applyQuery } from '../query';

// ── localStorage adapter ────────────────────────────────

export class LocalStorageAdapter implements StorageAdapter {
  private prefix: string;

  constructor(options?: { prefix?: string }) {
    this.prefix = options?.prefix ?? 'ilr:';
  }

  private key(collection: string, id: string): string {
    return `${this.prefix}${collection}:${id}`;
  }

  private collectionPrefix(collection: string): string {
    return `${this.prefix}${collection}:`;
  }

  async get(collection: string, id: string): Promise<any | null> {
    const value = localStorage.getItem(this.key(collection, id));
    return value ? JSON.parse(value) : null;
  }

  async set(collection: string, id: string, data: any): Promise<void> {
    localStorage.setItem(this.key(collection, id), JSON.stringify({ ...data, id }));
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const key = this.key(collection, id);
    if (localStorage.getItem(key) === null) return false;
    localStorage.removeItem(key);
    return true;
  }

  async list(collection: string, query?: Query): Promise<any[]> {
    const prefix = this.collectionPrefix(collection);
    const items: any[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        const value = localStorage.getItem(key);
        if (value) items.push(JSON.parse(value));
      }
    }

    return applyQuery(items, query);
  }

  /** Clear all data for a collection. */
  async clearCollection(collection: string): Promise<void> {
    const prefix = this.collectionPrefix(collection);
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  }
}

// ── IndexedDB adapter ───────────────────────────────────

export class IndexedDBAdapter implements StorageAdapter {
  private dbName: string;
  private dbVersion: number;
  private db: IDBDatabase | null = null;
  private collections: Set<string>;

  constructor(options?: { dbName?: string; collections?: string[] }) {
    this.dbName = options?.dbName ?? 'ilovereact-storage';
    this.collections = new Set(options?.collections ?? []);
    this.dbVersion = 1;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Create object stores for known collections
        for (const name of this.collections) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      request.onerror = () => reject(request.error);
    });
  }

  private async ensureStore(collection: string): Promise<IDBDatabase> {
    const db = await this.getDB();

    // If store already exists, return
    if (db.objectStoreNames.contains(collection)) return db;

    // Need to upgrade the database to add a new store
    this.db?.close();
    this.db = null;
    this.collections.add(collection);
    this.dbVersion++;

    return this.getDB();
  }

  async get(collection: string, id: string): Promise<any | null> {
    const db = await this.ensureStore(collection);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(collection, 'readonly');
      const store = tx.objectStore(collection);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async set(collection: string, id: string, data: any): Promise<void> {
    const db = await this.ensureStore(collection);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(collection, 'readwrite');
      const store = tx.objectStore(collection);
      const request = store.put({ ...data, id });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const db = await this.ensureStore(collection);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(collection, 'readwrite');
      const store = tx.objectStore(collection);
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async list(collection: string, query?: Query): Promise<any[]> {
    const db = await this.ensureStore(collection);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(collection, 'readonly');
      const store = tx.objectStore(collection);
      const request = store.getAll();
      request.onsuccess = () => {
        const items = request.result;
        resolve(applyQuery(items, query));
      };
      request.onerror = () => reject(request.error);
    });
  }

  /** Clear all data for a collection. */
  async clearCollection(collection: string): Promise<void> {
    const db = await this.ensureStore(collection);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(collection, 'readwrite');
      const store = tx.objectStore(collection);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
