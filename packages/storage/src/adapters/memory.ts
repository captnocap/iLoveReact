/**
 * In-memory storage adapter. Useful for testing, prototyping,
 * and targets that don't have persistent storage.
 * Data is lost when the app closes.
 */

import type { StorageAdapter, Query } from '../types';
import { applyQuery } from '../query';

export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, Map<string, any>>();

  private getCollection(collection: string): Map<string, any> {
    let col = this.store.get(collection);
    if (!col) {
      col = new Map();
      this.store.set(collection, col);
    }
    return col;
  }

  async get(collection: string, id: string): Promise<any | null> {
    const col = this.getCollection(collection);
    return col.get(id) ?? null;
  }

  async set(collection: string, id: string, data: any): Promise<void> {
    const col = this.getCollection(collection);
    col.set(id, { ...data, id });
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const col = this.getCollection(collection);
    return col.delete(id);
  }

  async list(collection: string, query?: Query): Promise<any[]> {
    const col = this.getCollection(collection);
    const items = Array.from(col.values());
    return applyQuery(items, query);
  }

  /** Clear all data (useful for tests). */
  clear(): void {
    this.store.clear();
  }
}
