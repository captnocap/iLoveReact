/**
 * Love2D file-based storage adapter.
 *
 * Uses the existing RPC bridge to call Lua-side handlers that read/write
 * files via love.filesystem. Supports JSON, Markdown, and plain text formats.
 *
 * Data is stored in the Love2D save directory:
 *   save/<collection>/<id>.<ext>
 */

import type { StorageAdapter, StorageFormat, Query } from '../types';
import { applyQuery } from '../query';

export interface Love2DFileAdapterOptions {
  format?: StorageFormat;
  /** RPC caller function — typically from useLoveRPC or bridge.rpc */
  rpc: <T>(method: string, args?: any) => Promise<T>;
}

export class Love2DFileAdapter implements StorageAdapter {
  format: StorageFormat;
  private rpc: <T>(method: string, args?: any) => Promise<T>;

  constructor(options: Love2DFileAdapterOptions) {
    this.format = options.format ?? 'json';
    this.rpc = options.rpc;
  }

  async get(collection: string, id: string): Promise<any | null> {
    return await this.rpc('storage:get', { collection, id, format: this.format });
  }

  async set(collection: string, id: string, data: any): Promise<void> {
    await this.rpc('storage:set', { collection, id, data, format: this.format });
  }

  async delete(collection: string, id: string): Promise<boolean> {
    return await this.rpc<boolean>('storage:delete', { collection, id });
  }

  async list(collection: string, query?: Query): Promise<any[]> {
    const items = await this.rpc<any[]>('storage:list', { collection });
    return applyQuery(items, query);
  }
}
